import { MendixPlatformClient } from "mendixplatformsdk";
import type { IModel } from "mendixmodelsdk";
import type { OnlineWorkingCopy } from "mendixplatformsdk";

export interface SessionState {
  token: string | null;
  appId: string | null;
  workingCopy: OnlineWorkingCopy | null;
  workingCopyId: string | null;
  model: IModel | null;
  branchName: string | null;
}

export const state: SessionState = {
  token: null,
  appId: null,
  workingCopy: null,
  workingCopyId: null,
  model: null,
  branchName: null,
};

export function getClient(): MendixPlatformClient {
  if (!state.token) {
    throw new Error("No access token configured. Call configure_token first.");
  }
  return new MendixPlatformClient();
}

export function requireAppId(): string {
  if (!state.appId) {
    throw new Error("No app configured. Call configure_app first.");
  }
  return state.appId;
}

export function requireWorkingCopy(): { workingCopy: OnlineWorkingCopy; model: IModel; branchName: string } {
  if (!state.workingCopy || !state.model || !state.branchName) {
    throw new Error(
      "No working copy is open in this session. Call open_working_copy first."
    );
  }
  return { workingCopy: state.workingCopy, model: state.model, branchName: state.branchName };
}

export function clearWorkingCopy(): void {
  state.workingCopy = null;
  state.workingCopyId = null;
  state.model = null;
  state.branchName = null;
}
