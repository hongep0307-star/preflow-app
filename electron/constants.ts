// Electron main-process 용 상수 & 런타임 값.
//
// `LOCAL_SERVER_PORT` 는 "선호 포트" (default 19876). 실제로 bind 된 포트는
// startLocalServer() 가 호출된 뒤 `getLocalServerPort()` / `getLocalServerBaseUrl()`
// 로 조회한다. 포트 충돌 시 OS 가 할당한 랜덤 포트로 fallback 될 수 있으므로,
// 반드시 getter 를 사용해야 올바른 URL 을 얻을 수 있다.

import { randomBytes } from "crypto";
import { LOCAL_SERVER_PORT, LOCAL_SERVER_BASE_URL } from "../shared/constants";

let actualPort: number = LOCAL_SERVER_PORT;
let actualBaseUrl: string = LOCAL_SERVER_BASE_URL;
const localServerAuthToken = randomBytes(32).toString("hex");

/** local-server 가 실제로 bind 한 포트를 기록한다.
 *  startLocalServer() 내부에서만 호출해야 한다. */
export function setLocalServerPort(port: number): void {
  actualPort = port;
  actualBaseUrl = `http://127.0.0.1:${port}`;
}

export function getLocalServerPort(): number {
  return actualPort;
}

export function getLocalServerBaseUrl(): string {
  return actualBaseUrl;
}

export function getLocalServerAuthToken(): string {
  return localServerAuthToken;
}

// Back-compat — 선호 포트 상수 자체는 그대로 노출.
export { LOCAL_SERVER_PORT, LOCAL_SERVER_BASE_URL };
