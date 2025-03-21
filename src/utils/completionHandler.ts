import * as vscode from "vscode"
import { wrapFile } from "./fileWrapper"

export function initializeCompletionHandler(context: vscode.ExtensionContext) {
	context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            { language: "json", pattern: "**/*.json" },
            new JsonCompletionProvider(),
        )
    )
}

class JsonCompletionProvider implements vscode.CompletionItemProvider {
    async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.CompletionItem[]> {
		let result: vscode.CompletionItem[] = []
		await wrapFile(
            document, 
            async (tempTsFilePath) => {
                result = await getCompletionsFromVSCode(tempTsFilePath, position, document)
            },
            async () => {
                result = await handleUntaggedFile(document, position)
            },
        )

		return structuredClone(result)
    }
}

async function getCompletionsFromVSCode(tempTsFilePath: string, position: vscode.Position, jsonDoc: vscode.TextDocument): Promise<vscode.CompletionItem[]> {
    const uri = vscode.Uri.file(tempTsFilePath)
	const offsetPosition = new vscode.Position(position.line + 2, position.character)

    // Ask VS Code to fetch completions
    const completionList = await vscode.commands.executeCommand<vscode.CompletionList>(
        "vscode.executeCompletionItemProvider",
        uri,
        offsetPosition
    )

    if (!completionList) return []

	const filteredResult = completionList.items.filter(item => (
		(item.kind === vscode.CompletionItemKind.Field)
     || (item.kind === vscode.CompletionItemKind.Property)
	 || (item.kind === vscode.CompletionItemKind.Constant)
	) && (
		typeof item.label === "string" // This removes generic suggestions which are usually not relevant
	))

	const mappedResult = filteredResult.map<vscode.CompletionItem>(item => {
        const insertText = (typeof item.insertText === "string") ? item.insertText : (item.insertText?.value || "")

        // Surround property names with double quotes to fit JSON syntax
        if (item.kind as any === vscode.CompletionItemKind.Field) {
            const line = jsonDoc.lineAt(position.line).text
            const [previous, next] = [line[position.character - 1], line[position.character]]
            const isSurrounded = ((previous === '"') && (next === '"'))

            return {
                label: item.label,
                insertText: isSurrounded ? insertText : `"${insertText}"`,
                kind: item.kind
            }
        }
        
        return {
            label: item.label,
            insertText: insertText,
            kind: item.kind
        }
    })

    return mappedResult
}


const activeRequests = new Set<string>()
async function handleUntaggedFile(document: vscode.TextDocument, position: vscode.Position) {
    // if getCompletionsFromVsCode is called on the current textdocument, since that's a JSON, then it would cause an infinite loop
    // So this activeRequests set allows us to break out of the loop.
    if (activeRequests.has(document.uri.fsPath)) return []

    activeRequests.add(document.uri.fsPath)

    try {
        const result = await getCompletionsFromVSCode(document.uri.fsPath, position, document)
    
        // Some JSON files such as package.json or tsconfig.json follow an implicit schema
        // For those, we don't add the $type suggestion
        const isSpecialJSON = !result.find(item => (item.label === "$schema"))
        if (isSpecialJSON) return result;

        const item = new vscode.CompletionItem('"$type"', vscode.CompletionItemKind.Snippet)
        item.insertText = new vscode.SnippetString(': {\n\t"$$from": "$1",\n\t"$$import": "$2"\n}$3')
        item.sortText = "0"
        item.preselect = true

        item.command = {
            command: "editor.action.insertSnippet",
            title: "Insert Snippet",
            arguments: [{ snippet: item.insertText.value }]
        }

        return [item]
    } finally {
        activeRequests.delete(document.uri.fsPath)
    }
}