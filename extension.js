const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

// debounce (cuz lua server only read files from disk)
let writeTimeout = null;

class MarkdownLuaMapper {
    static createVirtualLuaContent(mdText) {
        const lines = mdText.split(/\r?\n/);
        
        const processedLines = lines.map(line => {
            if (!line.includes('//%')) {
                return ' '.repeat(line.length);
            }

            const lineBuffer = line.split('');

            if (line.includes('//%(')) {
                const startTrigger = line.indexOf('//%(');
                const endBracket = line.lastIndexOf(')');

                for (let i = 0; i < startTrigger + 4; i++) {
                    lineBuffer[i] = ' ';
                }
                if (endBracket !== -1) {
                    for (let i = endBracket; i < lineBuffer.length; i++) {
                        lineBuffer[i] = ' ';
                    }
                }
            } else {
                const startTrigger = line.indexOf('//%');
                for (let i = 0; i < startTrigger + 3; i++) {
                    lineBuffer[i] = ' ';
                }
            }

            return lineBuffer.join('');
        });

        return processedLines.join('\n');
    }

    static isCursorInLua(document, position) {
        const lineText = document.lineAt(position.line).text;
        return lineText.includes('//%');
    }

    // path to hidden file
    static getCacheUri(document) {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        if (!workspaceFolder) return null;

        const targetDir = path.join(workspaceFolder.uri.fsPath, '.git');
        
        // Генерируем уникальное имя файла для каждого MD-файла, чтобы они не конфликтовали
        const safeName = document.uri.fsPath.replace(/[^a-zA-Z0-9]/g, '_') + '.lua';
        const tempFilePath = path.join(targetDir, safeName);

        return {
            dir: targetDir,
            path: tempFilePath,
            uri: vscode.Uri.file(tempFilePath)
        };
    }

    // sync by debounce
    static syncVirtualCache(document, virtualLuaContent) {
        return new Promise((resolve) => {
            const cache = MarkdownLuaMapper.getCacheUri(document);
            if (!cache) return resolve(null);

            if (writeTimeout) clearTimeout(writeTimeout);

            // debounce
            writeTimeout = setTimeout(() => {
                try {
                    if (!fs.existsSync(cache.dir)) {
                        fs.mkdirSync(cache.dir, { recursive: true });
                    }
                    if (fs.existsSync(cache.path)) {
                        fs.chmodSync(cache.path, 0o666);
                    }
                    fs.writeFileSync(cache.path, virtualLuaContent, 'utf8');
                    fs.chmodSync(cache.path, 0o444);
                } catch (e) {
                    try {
                        fs.writeFileSync(cache.path, virtualLuaContent, 'utf8');
                    } catch (err) {
                        return resolve(null);
                    }
                }
                resolve(cache.uri);
            }, 10);
        });
    }
}

function activate(context) {
    
	//autocomplete
    const completionProvider = vscode.languages.registerCompletionItemProvider(
        'markdown',
        {
            async provideCompletionItems(document, position, token, contextProvider) {
                if (!MarkdownLuaMapper.isCursorInLua(document, position)) return undefined;

                const mdText = document.getText();
                const virtualLuaContent = MarkdownLuaMapper.createVirtualLuaContent(mdText);
                
                // Ждем пока файл гарантированно запишется на диск
                const fileUri = await MarkdownLuaMapper.syncVirtualCache(document, virtualLuaContent);
                if (!fileUri) return undefined;

                // Запрашиваем автокомплит напрямую по URI (без вызова медленного openTextDocument)
                const completions = await vscode.commands.executeCommand(
                    'vscode.executeCompletionItemProvider',
                    fileUri,
                    position,
                    contextProvider.triggerCharacter
                );

                if (!completions || !completions.items) return completions;

                completions.items = completions.items.map(item => {
                    if (item.range) {
                        if (item.range instanceof vscode.Range) {
                            item.range = new vscode.Range(position.line, item.range.start.character, position.line, item.range.end.character);
                        } else if (item.range.inserting instanceof vscode.Range) {
                            item.range.inserting = new vscode.Range(position.line, item.range.inserting.start.character, position.line, item.range.inserting.end.character);
                            item.range.replacing = new vscode.Range(position.line, item.range.replacing.start.character, position.line, item.range.replacing.end.character);
                        }
                    }
                    return item;
                });

                return completions;
            }
        },
        '.', '(', ':', '@'
    );

	//go to definition
    const definitionProvider = vscode.languages.registerDefinitionProvider(
        'markdown',
        {
            async provideDefinition(document, position, token) {
                if (!MarkdownLuaMapper.isCursorInLua(document, position)) return undefined;

                const mdText = document.getText();
                const virtualLuaContent = MarkdownLuaMapper.createVirtualLuaContent(mdText);
                
                const fileUri = await MarkdownLuaMapper.syncVirtualCache(document, virtualLuaContent);
                if (!fileUri) return undefined;

                const definitions = await vscode.commands.executeCommand(
                    'vscode.executeDefinitionProvider',
                    fileUri,
                    position
                );

                if (!definitions) return undefined;

                const redirectDefinition = (loc) => {
                    // our hidden file -> md
                    if (loc.uri && loc.uri.fsPath === fileUri.fsPath) {
                        return new vscode.Location(document.uri, loc.range);
                    }
                    // real files
                    return loc;
                };

                if (Array.isArray(definitions)) {
                    return definitions.map(loc => redirectDefinition(loc));
                } else {
                    return redirectDefinition(definitions);
                }
            }
        }
    );

    context.subscriptions.push(completionProvider, definitionProvider);
}

function deactivate() {
    if (writeTimeout) clearTimeout(writeTimeout);
}

module.exports = { activate, deactivate };
