import { MendixPlatformClient } from "mendixplatformsdk";
export const state = {
    token: null,
    appId: null,
    workingCopy: null,
    workingCopyId: null,
    model: null,
    branchName: null,
};
export function getClient() {
    if (!state.token) {
        throw new Error("No access token configured. Call configure_token first.");
    }
    return new MendixPlatformClient();
}
export function requireAppId() {
    if (!state.appId) {
        throw new Error("No app configured. Call configure_app first.");
    }
    return state.appId;
}
export function requireWorkingCopy() {
    if (!state.workingCopy || !state.model || !state.branchName) {
        throw new Error("No working copy is open in this session. Call open_working_copy first.");
    }
    return { workingCopy: state.workingCopy, model: state.model, branchName: state.branchName };
}
export function clearWorkingCopy() {
    state.workingCopy = null;
    state.workingCopyId = null;
    state.model = null;
    state.branchName = null;
}
//# sourceMappingURL=session.js.map