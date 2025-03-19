import * as vscode from "vscode";
import { initializeCompletionHandler } from "./utils/completionHandler";
import { initializeDiagnosticsHandler } from "./utils/diagnosticsHandler";

export function activate(context: vscode.ExtensionContext) {
	initializeCompletionHandler(context)
	initializeDiagnosticsHandler(context)
}

export function deactivate() {}
