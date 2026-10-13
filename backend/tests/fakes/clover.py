"""An in-memory stand-in for Clover, served through httpx.MockTransport.

Tests plug it in by replacing ``app.services.clover_client._http_client``, so
the real request-building code (URLs, headers, bodies, error mapping) runs.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any

import httpx


@dataclass
class FakeMerchant:
    merchant_id: str
    name: str = "Brow Beauty Lab"
    currency: str | None = "CAD"
    ecommerce_enabled: bool = True
    pakms_key: str = "pakms_public_key_123"


@dataclass
class RecordedRequest:
    method: str
    host: str
    path: str
    headers: dict[str, str]
    body: Any


@dataclass
class FakeClover:
    merchants: dict[str, FakeMerchant] = field(default_factory=dict)
    # authorization code -> merchant id
    codes: dict[str, str] = field(default_factory=dict)
    valid_access: dict[str, str] = field(default_factory=dict)  # access token -> merchant id
    valid_refresh: dict[str, str] = field(default_factory=dict)  # refresh token -> merchant id
    recoverable: set[str] = field(default_factory=set)  # refresh tokens recovery still accepts
    access_lifetime_seconds: int = 1800
    requests: list[RecordedRequest] = field(default_factory=list)
    payments: dict[str, dict[str, Any]] = field(default_factory=dict)  # payment id -> Clover payload
    payment_merchant: dict[str, str] = field(default_factory=dict)
    _counter: int = 0

    # -- setup helpers -----------------------------------------------------
    def add_merchant(self, merchant_id: str = "MERCHANT1", **kwargs: Any) -> FakeMerchant:
        merchant = FakeMerchant(merchant_id=merchant_id, **kwargs)
        self.merchants[merchant_id] = merchant
        return merchant

    def issue_code(self, merchant_id: str = "MERCHANT1", code: str = "good-code") -> str:
        self.codes[code] = merchant_id
        return code

    def issue_tokens(self, merchant_id: str) -> dict[str, Any]:
        self._counter += 1
        access = f"access-{self._counter}"
        refresh = f"refresh-{self._counter}"
        self.valid_access[access] = merchant_id
        self.valid_refresh[refresh] = merchant_id
        now = int(time.time())
        return {
            "access_token": access,
            "access_token_expiration": now + self.access_lifetime_seconds,
            "refresh_token": refresh,
            "refresh_token_expiration": now + 14 * 86400,
        }

    def add_device_payment(
        self,
        merchant_id: str = "MERCHANT1",
        *,
        amount: int,
        tip: int = 0,
        result: str = "SUCCESS",
        last4: str = "4242",
        brand: str = "VISA",
        auth_code: str | None = None,
        refunded: int = 0,
        age_minutes: float = 1,
        payment_id: str | None = None,
    ) -> str:
        """A card-present payment taken on the Flex. `amount` is before tip."""
        self._counter += 1
        pid = payment_id or f"PAY{self._counter:04d}"
        payload: dict[str, Any] = {
            "id": pid,
            "amount": amount,
            "tipAmount": tip,
            "result": result,
            "createdTime": int((time.time() - age_minutes * 60) * 1000),
            "cardTransaction": {"cardType": brand, "last4": last4, "authCode": auth_code or f"AUTH{self._counter}"},
            "employee": {"id": "EMP1"},
            "tender": {"label": "Credit Card"},
        }
        if refunded:
            payload["refunds"] = {"elements": [{"id": f"REF{self._counter}", "amount": refunded}]}
        self.payments[pid] = payload
        self.payment_merchant[pid] = merchant_id
        return pid

    def refund_device_payment(self, payment_id: str, amount: int) -> None:
        payload = self.payments[payment_id]
        elements = payload.setdefault("refunds", {"elements": []})["elements"]
        elements.append({"id": f"REF-{len(elements) + 1}", "amount": amount})

    def revoke_access(self, access_token: str) -> None:
        self.valid_access.pop(access_token, None)

    def calls(self, path_prefix: str) -> list[RecordedRequest]:
        return [r for r in self.requests if r.path.startswith(path_prefix)]

    # -- transport ---------------------------------------------------------
    def handler(self, request: httpx.Request) -> httpx.Response:
        body: Any = None
        if request.content:
            try:
                body = json.loads(request.content)
            except ValueError:
                body = request.content.decode()
        path = request.url.path
        self.requests.append(
            RecordedRequest(request.method, request.url.host, path, dict(request.headers), body)
        )

        if path == "/oauth/v2/token" and request.method == "POST":
            merchant_id = self.codes.pop((body or {}).get("code", ""), None)
            if merchant_id is None or not (body or {}).get("client_secret"):
                return httpx.Response(401, json={"message": "invalid_grant"})
            return httpx.Response(200, json=self.issue_tokens(merchant_id))

        if path == "/oauth/v2/refresh" and request.method == "POST":
            refresh = (body or {}).get("refresh_token", "")
            merchant_id = self.valid_refresh.pop(refresh, None)
            if merchant_id is None:
                headers = {"X-Clover-Recovery-Available": "true"} if refresh in self.recoverable else {}
                return httpx.Response(401, json={"message": "invalid refresh token"}, headers=headers)
            return httpx.Response(200, json=self.issue_tokens(merchant_id))

        if path == "/oauth/v2/recovery" and request.method == "POST":
            token = (body or {}).get("recovery_token", "")
            if token not in self.recoverable:
                return httpx.Response(401, json={"message": "recovery not available"})
            self.recoverable.discard(token)
            merchant_id = next(iter(self.merchants), "MERCHANT1")
            return httpx.Response(200, json=self.issue_tokens(merchant_id))

        bearer = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
        merchant_id = self.valid_access.get(bearer)
        if merchant_id is None:
            return httpx.Response(401, json={"message": "Unauthorized"})

        parts = path.split("/")
        if len(parts) >= 5 and parts[1:3] == ["v3", "merchants"] and parts[4] == "payments" and request.method == "GET":
            if parts[3] != merchant_id:
                return httpx.Response(404, json={"message": "Not Found"})
            if len(parts) == 6:
                payload = self.payments.get(parts[5])
                if payload is None or self.payment_merchant.get(parts[5]) != merchant_id:
                    return httpx.Response(404, json={"message": "Not Found"})
                return httpx.Response(200, json=payload)
            since = 0
            for key, value in request.url.params.multi_items():
                if key == "filter" and value.startswith("createdTime>="):
                    since = int(value.removeprefix("createdTime>="))
            elements = [
                p
                for pid, p in self.payments.items()
                if self.payment_merchant.get(pid) == merchant_id and p["createdTime"] >= since
            ]
            elements.sort(key=lambda p: p["createdTime"], reverse=True)
            return httpx.Response(200, json={"elements": elements})

        if path.startswith("/v3/merchants/") and request.method == "GET":
            requested = path.split("/")[3]
            merchant = self.merchants.get(requested)
            if merchant is None or requested != merchant_id:
                return httpx.Response(404, json={"message": "Not Found"})
            payload: dict[str, Any] = {"id": merchant.merchant_id, "name": merchant.name}
            if merchant.currency is not None:
                payload["defaultCurrency"] = merchant.currency
            return httpx.Response(200, json=payload)

        if path == "/pakms/apikey" and request.method == "GET":
            merchant = self.merchants.get(merchant_id)
            if merchant is None or not merchant.ecommerce_enabled:
                return httpx.Response(403, json={"message": "Ecommerce is not enabled"})
            return httpx.Response(200, json={"active": True, "apiAccessKey": merchant.pakms_key})

        return httpx.Response(404, json={"message": f"fake clover: no route for {request.method} {path}"})

    def client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.MockTransport(self.handler))
