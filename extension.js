const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

let writeTimeout = null;

class MarkdownLuaMapper { 
    
    static createVirtualLuaContent(mdText) {
        const lines = mdText.split(/\r?\n/);
        
        // Регулярка захватывает: 1) //%(...) или 2) //%... до конца слова/строки
        const injectRegex = /\/\/%(?:\((?:[^()]+|\([^()]*\))*\)|[^\s`'"\),]+)/g;

        const processedLines = lines.map(line => {
            let match;
            injectRegex.lastIndex = 0;
            
            // Создаем пустую строку из пробелов той же длины, чтобы сохранить позиции символов
            let cleanLine = ' '.repeat(line.length).split('');

            while ((match = injectRegex.exec(line)) !== null) {
                const fullMatch = match[0];
                const startIdx = match.index;

                if (fullMatch.startsWith('//%(')) {
                    // Случай '//%(' -> заменяем '//%(' на пробелы, а внутренности Lua переносим как есть
                    // Также заменяем закрывающую скобку ')' на пробел
                    const luaContentStart = startIdx + 4;
                    const luaContentEnd = startIdx + fullMatch.length - 1;

                    for (let i = luaContentStart; i < luaContentEnd; i++) {
                        cleanLine[i] = line[i];
                    }
                } else {
                    // Случай '//%' -> заменяем '//%' на пробелы, остальное переносим
                    const luaContentStart = startIdx + 3;
                    const luaContentEnd = startIdx + fullMatch.length;

                    for (let i = luaContentStart; i < luaContentEnd; i++) {
                        cleanLine[i] = line[i];
                    }
                }
            }

            return cleanLine.join('');
        });

        return processedLines.join('\n');
    }

    static isCursorInLua(document, position) {
        const lineText = document.lineAt(position.line).text;
        return lineText.includes('//%');
    }

    static getCacheUri(document) {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        if (!workspaceFolder) return null;

        // Внимание: папка .git может игнорироваться Lua-сервером по умолчанию!
        // Если автокомплит всё равно пустой, замените '.git' на '.vscode/LuaInjections'
        const targetDir = path.join(workspaceFolder.uri.fsPath, '.git', 'lua-cache');
        
        const safeName = document.uri.fsPath.replace(/[^a-zA-Z0-9]/g, '_') + '.lua';
        const tempFilePath = path.join(targetDir, safeName);

        return {
            dir: targetDir,
            path: tempFilePath,
            uri: vscode.Uri.file(tempFilePath)
        };
    }

    static syncVirtualCache(document, virtualLuaContent) {
        return new Promise((resolve) => {
            const cache = MarkdownLuaMapper.getCacheUri(document);
            if (!cache) return resolve(null);

            if (writeTimeout) clearTimeout(writeTimeout);

            writeTimeout = setTimeout(async () => {
                try {
                    if (!fs.existsSync(cache.dir)) {
                        fs.mkdirSync(cache.dir, { recursive: true });
                    }
                    fs.writeFileSync(cache.path, virtualLuaContent, 'utf8');

                    // КРИТИЧЕСКИЙ ШАГ: Оповещаем VS Code и Lua-сервер, что файл обновился.
                    // Открываем его в фоне (без показа пользователю).
                    const doc = await vscode.workspace.openTextDocument(cache.uri);
                    
                    resolve(cache.uri);
                } catch (e) {
                    resolve(null);
                }
            }, 50); // Небольшой таймаут для дебаунса
        });
    }
}

function activate(context) {
    
    const completionProvider = vscode.languages.registerCompletionItemProvider(
        '*', 
        {
            async provideCompletionItems(document, position, token, contextProvider) {
                if (!MarkdownLuaMapper.isCursorInLua(document, position)) return undefined;

                const mdText = document.getText();
                const virtualLuaContent = MarkdownLuaMapper.createVirtualLuaContent(mdText);
                
                const fileUri = await MarkdownLuaMapper.syncVirtualCache(document, virtualLuaContent);
                if (!fileUri) return undefined;

                // Запрашиваем автокомплит у Lua-сервера для нашего виртуального файла
                const completions = await vscode.commands.executeCommand(
                    'vscode.executeCompletionItemProvider',
                    fileUri,
                    position,
                    contextProvider.triggerCharacter
                );

                if (!completions || !completions.items) return completions;

                // Корректируем координаты (Range), чтобы подсказки вставлялись в Markdown-файл, а не в виртуальный
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

                return new vscode.CompletionList(completions.items, true); ;
            }
        },
        '.', '(', ':', '@', '"', "'" // Добавил кавычки для триггера путей/модулей
    );

    const definitionProvider = vscode.languages.registerDefinitionProvider(
        '*',
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
                    if (loc.uri && loc.uri.fsPath === fileUri.fsPath) {
                        return new vscode.Location(document.uri, loc.range);
                    }
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
// Отслеживаем смену позиции курсора
const cursorMoveListener = vscode.window.onDidChangeTextEditorSelection(async (e) => {
    const editor = e.textEditor;
    if (!editor) return;

    const document = editor.document;
    // Нас интересуют только целевые языки (например, html, markdown)
    if (document.languageId !== 'html' && document.languageId !== 'markdown') return;

    const position = editor.selection.active;
    const lineText = document.lineAt(position.line).text;
    
    // Получаем конфигурацию конкретно для языка текущего документа
    const config = vscode.workspace.getConfiguration('editor', document.uri);

    if (lineText.includes('//%')) {
        // Курсор внутри директивы -> вырубаем текстовые подсказки 'abc'
        // ConfigurationTarget.WorkspaceFolder применит это только локально, не ломая глобальные настройки
        if (config.get('wordBasedSuggestions') !== 'off') {
            await config.update('wordBasedSuggestions', 'off', vscode.ConfigurationTarget.WorkspaceFolder);
        }
    } else {
        // Курсор вышел из директивы -> возвращаем дефолтное поведение (true/matchingDocuments)
        if (config.get('wordBasedSuggestions') === 'off') {
            await config.update('wordBasedSuggestions', undefined, vscode.ConfigurationTarget.WorkspaceFolder);
        }
    }
});

context.subscriptions.push(cursorMoveListener);

}

function deactivate() {
    if (writeTimeout) clearTimeout(writeTimeout);
}

module.exports = { activate, deactivate };
