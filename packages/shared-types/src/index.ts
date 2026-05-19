export type HealthStatus = "ok";

export type ApiRootResponse = {
  message: string;
  environment: string;
  version: string;
};

export type HealthResponse = {
  status: HealthStatus;
  service: string;
  environment: string;
};