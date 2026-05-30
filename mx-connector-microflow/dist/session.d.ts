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
export declare const state: SessionState;
export declare function getClient(): MendixPlatformClient;
export declare function requireAppId(): string;
export declare function requireWorkingCopy(): {
    workingCopy: OnlineWorkingCopy;
    model: IModel;
    branchName: string;
};
export declare function clearWorkingCopy(): void;
