export type GitHubConnectionStatus = "active" | "disconnected";
export type GitHubAccountType = "User" | "Organization";
export type GitHubRepositorySelection = "all" | "selected" | null;
export type GitHubConnectionPurpose = "install" | "oauth_verify";

export interface GitHubConnection {
  id: string;
  userId: string;
  installationId: number;
  accountId: number;
  accountLogin: string;
  accountType: GitHubAccountType;
  repositorySelection: GitHubRepositorySelection;
  permissions: Record<string, string>;
  status: GitHubConnectionStatus;
  connectedAt: string;
  lastVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GitHubConnectionState {
  id: string;
  userId: string;
  purpose: GitHubConnectionPurpose;
  installationId: number | null;
  pkceVerifier: string | null;
  expiresAt: string;
  consumedAt: string | null;
}

export interface GitHubInstallation {
  id: number;
  account: {
    id: number;
    login: string;
    type: GitHubAccountType;
  };
  repository_selection: GitHubRepositorySelection;
  permissions: Record<string, string>;
}

export interface GitHubUserIdentity {
  id: number;
  login: string;
}

export interface GitHubRepositorySummary {
  owner: string;
  name: string;
  full_name: string;
  private: boolean;
  description: string | null;
  default_branch: string;
  html_url: string;
  updated_at: string;
}

export interface GitHubRepositoryDetail extends GitHubRepositorySummary {
  language: string | null;
  open_issues_count: number;
}

export interface GitHubPullRequestSummary {
  number: number;
  title: string;
  state: "open" | "closed";
  draft: boolean;
  author_login: string | null;
  created_at: string;
  updated_at: string;
  html_url: string;
}

export interface GitHubIssueSummary {
  number: number;
  title: string;
  state: "open" | "closed";
  author_login: string | null;
  labels: string[];
  created_at: string;
  updated_at: string;
  html_url: string;
}

export interface LimitedResult<T> {
  items: T[];
  truncated: boolean;
}
