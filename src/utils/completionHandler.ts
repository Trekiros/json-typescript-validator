import * as vscode from "vscode";
import { wrapFile } from "./fileWrapper";

export function initializeCompletionHandler(context: vscode.ExtensionContext) {
	context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            { language: "json", pattern: "**/*.json" },
            new JsonCompletionProvider(),
			
			// Triggering characters
            '{', '.', '"', " "
        )
    );
}

class JsonCompletionProvider implements vscode.CompletionItemProvider {
    async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.CompletionItem[]> {
		let result: vscode.CompletionItem[] = []
		await wrapFile(document, async ({ tempTsFilePath }) => {
			result = await getCompletionsFromVSCode(tempTsFilePath, position)
		})

		return structuredClone(result)
    }
}

async function getCompletionsFromVSCode(tempTsFilePath: string, position: vscode.Position): Promise<vscode.CompletionItem[]> {
    const uri = vscode.Uri.file(tempTsFilePath);
	const offsetPosition = new vscode.Position(position.line + 2, position.character)

	// Force vscode's typescript language server to evaluate the temporary file
	// TODO: this doesn't work yet, the user still needs to manually open the file for typescript to evaluate the file
	await forceTypeScriptIndexing(uri)

    // Ask VS Code to fetch completions
    const completionList = await vscode.commands.executeCommand<vscode.CompletionList>(
        "vscode.executeCompletionItemProvider",
        uri,
        offsetPosition
    );

    if (!completionList) {
        console.warn("No completions received from VS Code.");
        return [];
    }

	const filteredResult = completionList.items.filter(item => (
		(item.kind === vscode.CompletionItemKind.Field)
	 || (item.kind === vscode.CompletionItemKind.Constant)
	) && (
		typeof item.label === "string" // This removes generic suggestions which are usually not relevant
	))

	const mappedResult = filteredResult.map(item => ({
		label: item.label,
		insertText: (item.kind as any === vscode.CompletionItemKind.Field) ? (
			'"' + (
				(!item.insertText) ? ""
			: (typeof item.insertText === "string") ? item.insertText 
			: item.insertText.value
			).replaceAll('"', '\\"') + '"'
		) : (
			item.insertText
		),
		kind: item.kind
	}))

    return mappedResult;
}

// VSCode's TypeScript instance only starts giving accurate completion items if the file is opened in an actual tab of the workspace
// This function ensures that is the case.
const alreadyOpened = new Set<string>()
async function forceTypeScriptIndexing(uri: vscode.Uri) {
	if (alreadyOpened.has(uri.fsPath)) return;

	// Open document without losing focus on the current tab
	const document = await vscode.workspace.openTextDocument(uri)
	const editor = await vscode.window.showTextDocument(document, {
		viewColumn: vscode.ViewColumn.Beside, // Open in a new tab beside the current one
		preview: true, // Open as a preview (auto-closes when replaced)
		preserveFocus: true, // Do NOT take focus away
	})

	// Wait until the diagnostics start giving actual results
	const startTime = Date.now();
	const timeout = 2000
    while ((Date.now() - startTime < timeout) && !vscode.languages.getDiagnostics(uri).length) {
        await new Promise(resolve => setTimeout(resolve, 500));
	}

	// Close the temporary tab
	for (const group of vscode.window.tabGroups.all) {
		const tab = group.tabs.find(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.fsPath === uri.fsPath);
		
		if (tab) {
			await vscode.window.tabGroups.close(tab); // Close it without switching focus
			break;
		}
	}

	// This only needs to be done once
	alreadyOpened.add(uri.fsPath)
}