import * as vscode from "vscode"
import { initializeCompletionHandler } from "./utils/completionHandler"
import { initializeDiagnosticsHandler } from "./utils/diagnosticsHandler"
import { initializeHoverProvider } from "./utils/hoverProvider"

export function activate(context: vscode.ExtensionContext) {
	initializeCompletionHandler(context)
	initializeDiagnosticsHandler(context)
	initializeHoverProvider(context)
}

export function deactivate() {}
