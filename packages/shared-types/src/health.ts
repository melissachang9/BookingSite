import type { EnvironmentName } from "./common";

export type HealthStatus = "ok";

export type ApiRootResponse = {
  message: string;
  environment: EnvironmentName | string;
  version: string;
};

export type HealthResponse = {
  status: HealthStatus;
  service: string;
  environment: EnvironmentName | string;
};