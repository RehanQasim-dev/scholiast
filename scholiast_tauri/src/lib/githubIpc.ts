import { invokeCommand } from "./ipc";

export interface GithubStatus {
  connected: boolean;
}

export interface GithubConnectStart {
  url: string;
}

export interface GithubAccount {
  login: string;
  avatar_url: string | null;
}

export interface GithubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
}

export function githubConnect(): Promise<GithubConnectStart> {
  return invokeCommand<GithubConnectStart>("github_connect");
}

export function githubComplete(args: { code: string; state: string }): Promise<GithubAccount> {
  return invokeCommand<GithubAccount>("github_complete", args);
}

export function githubDisconnect(): Promise<boolean> {
  return invokeCommand<boolean>("github_disconnect");
}

export function githubStatus(): Promise<GithubStatus> {
  return invokeCommand<GithubStatus>("github_status");
}

export function listGithubRepos(): Promise<GithubRepo[]> {
  return invokeCommand<GithubRepo[]>("github_repos");
}

export function setGithubSecret(kind: "github.client_id" | "github.client_secret", value: string): Promise<void> {
  return invokeCommand<void>("set_secret", { name: kind, value });
}

export function githubSecretStatus(kind: "github.client_id" | "github.client_secret"): Promise<{ configured: boolean }> {
  return invokeCommand<{ configured: boolean }>("get_secret_status", { name: kind });
}
