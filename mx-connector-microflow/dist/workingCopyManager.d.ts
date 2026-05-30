import type { OpenWorkingCopyArgs, CommitWorkingCopyArgs, DiscardWorkingCopyArgs } from "./types.js";
export declare function openWorkingCopy(args: OpenWorkingCopyArgs): Promise<{
    workingCopyId: string;
    branchName: string;
    reused: boolean;
}>;
export declare function commitWorkingCopy(args: CommitWorkingCopyArgs): Promise<{
    workingCopyId: string;
    branchName: string;
    commitMessage: string;
}>;
export declare function discardWorkingCopy(args: DiscardWorkingCopyArgs): Promise<{
    workingCopyId: string;
    branchName: string;
    reason: string;
}>;
