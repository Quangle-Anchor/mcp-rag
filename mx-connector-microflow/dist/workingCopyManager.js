import { state, getClient, requireAppId, requireWorkingCopy, clearWorkingCopy, } from "./session.js";
export async function openWorkingCopy(args) {
    if (state.workingCopy && state.model) {
        return {
            workingCopyId: state.workingCopyId ?? state.workingCopy.workingCopyId,
            branchName: state.branchName ?? "main",
            reused: true,
        };
    }
    const appId = requireAppId();
    const client = getClient();
    const app = client.getApp(appId);
    const branchName = args.branchName ?? "main";
    const options = args.commitId ? { commitId: args.commitId } : undefined;
    const workingCopy = await app.createTemporaryWorkingCopy(branchName, options);
    const model = await workingCopy.openModel();
    state.workingCopy = workingCopy;
    state.workingCopyId = workingCopy.workingCopyId;
    state.model = model;
    state.branchName = branchName;
    return {
        workingCopyId: workingCopy.workingCopyId,
        branchName,
        reused: false,
    };
}
export async function commitWorkingCopy(args) {
    const { workingCopy, model, branchName } = requireWorkingCopy();
    const targetBranch = args.branchName ?? branchName;
    const commitMessage = args.commitMessage ?? "Update via mx-connect";
    await model.flushChanges();
    await workingCopy.commitToRepository(targetBranch, { commitMessage });
    const workingCopyId = workingCopy.workingCopyId;
    clearWorkingCopy();
    return { workingCopyId, branchName: targetBranch, commitMessage };
}
export async function discardWorkingCopy(args) {
    // `mendixplatformsdk@5.x` provides no API to drop / delete a working copy —
    // not on `App`, not on `OnlineWorkingCopy`, not on the lower-level
    // `RepositoriesClient`. The platform server reclaims abandoned temporary
    // working copies on its own GC schedule. The best a caller can do is
    // release the in-memory handle so that the next `open_working_copy` creates
    // a fresh one instead of reusing the broken / uncommittable handle.
    //
    // Use this tool when `commit_working_copy` fails in a way that cannot be
    // recovered (e.g. `flushChanges()` throws an SDK consistency error and the
    // working copy is left in an invalid in-memory state).
    const { workingCopy, branchName } = requireWorkingCopy();
    const workingCopyId = workingCopy.workingCopyId;
    const reason = args.reason ?? "<no reason given>";
    clearWorkingCopy();
    return { workingCopyId, branchName, reason };
}
//# sourceMappingURL=workingCopyManager.js.map