import { decodeCodeEntities, stripLineEscapes } from "@/lib/insert";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("csharp", csharp);
hljs.registerLanguage("css", css);
hljs.registerLanguage("go", go);
hljs.registerLanguage("java", java);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("php", php);
hljs.registerLanguage("python", python);
hljs.registerLanguage("ruby", ruby);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);

const HIGHLIGHT: Record<string, string> = {
  php: "php",
  phtml: "php",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  css: "css",
  scss: "css",
  less: "css",
  html: "xml",
  htm: "xml",
  xml: "xml",
  svg: "xml",
  json: "json",
  sql: "sql",
  java: "java",
  cs: "csharp",
  go: "go",
  rb: "ruby",
  rs: "rust",
  md: "markdown",
  markdown: "markdown",
  sh: "bash",
  bash: "bash",
};

type PrettierPlugin = object;

const cache = new Map<string, { text: string; html: string }>();

export async function presentCode(filename: string, content: string): Promise<{ text: string; html: string }> {
  const key = `${filename}\0${content}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const decoded = stripLineEscapes(decodeCodeEntities(content).replace(/\r\n/g, "\n"));
  const text = (await formatCode(filename, decoded)).replace(/\n$/, "");
  const html = highlightCode(filename, text);
  const result = { text, html };
  cache.set(key, result);
  if (cache.size > 40) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  return result;
}

async function formatCode(filename: string, source: string): Promise<string> {
  const ext = extension(filename);
  if (!source.trim() || ext === "txt" || !ext) return source;
  try {
    const prettier = await import("prettier/standalone");
    const plugins = await pluginsFor(ext);
    if (!plugins) return indentLoose(source);
    const formatted = await prettier.format(source, {
      parser: parserFor(ext),
      plugins,
      tabWidth: ext === "php" || ext === "phtml" ? 4 : 2,
      useTabs: false,
      printWidth: 100,
      ...(ext === "php" || ext === "phtml" ? { phpVersion: "8.3" } : {}),
    });
    if ((ext === "php" || ext === "phtml") && stripEnd(formatted) === stripEnd(source)) return indentLoose(source);
    return formatted;
  } catch {
    return indentLoose(source);
  }
}

function parserFor(ext: string): string {
  if (ext === "php" || ext === "phtml") return "php";
  if (ext === "ts" || ext === "tsx") return ext === "tsx" ? "typescript" : "typescript";
  if (ext === "json") return "json";
  if (ext === "css") return "css";
  if (ext === "scss") return "scss";
  if (ext === "less") return "less";
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "md" || ext === "markdown") return "markdown";
  return "babel";
}

async function pluginsFor(ext: string): Promise<PrettierPlugin[] | null> {
  if (ext === "php" || ext === "phtml") {
    const phpPlugin = await import("@prettier/plugin-php/standalone");
    return [pluginOf(phpPlugin)];
  }
  if (ext === "css" || ext === "scss" || ext === "less") {
    const postcss = await import("prettier/plugins/postcss");
    return [pluginOf(postcss)];
  }
  if (ext === "html" || ext === "htm") {
    const html = await import("prettier/plugins/html");
    return [pluginOf(html)];
  }
  if (ext === "md" || ext === "markdown") {
    const markdown = await import("prettier/plugins/markdown");
    return [pluginOf(markdown)];
  }
  if (ext === "js" || ext === "jsx" || ext === "mjs" || ext === "cjs" || ext === "ts" || ext === "tsx" || ext === "json") {
    const babel = await import("prettier/plugins/babel");
    const estree = await import("prettier/plugins/estree");
    const plugins = [pluginOf(babel), pluginOf(estree)];
    if (ext === "ts" || ext === "tsx") {
      const typescript = await import("prettier/plugins/typescript");
      plugins.unshift(pluginOf(typescript));
    }
    return plugins;
  }
  return null;
}

function pluginOf(mod: unknown): PrettierPlugin {
  if (mod && typeof mod === "object" && "default" in mod && (mod as { default?: PrettierPlugin }).default) {
    return (mod as { default: PrettierPlugin }).default;
  }
  return mod as PrettierPlugin;
}

function highlightCode(filename: string, source: string): string {
  const language = HIGHLIGHT[extension(filename)];
  if (!language) return escapeHtml(source);
  try {
    return hljs.highlight(source, { language, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(source);
  }
}

function stripEnd(value: string): string {
  return value.replace(/\n+$/, "");
}

function extension(filename: string): string {
  const name = filename.split(/[/\\]/).pop() ?? filename;
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function indentLoose(source: string): string {
  let level = 0;
  return source.split("\n").map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return "";
    const braces = scanBraces(trimmed);
    const indent = Math.max(0, level - braces.leadingClose);
    level = Math.max(0, level + braces.open - braces.close);
    return `${"    ".repeat(indent)}${trimmed}`;
  }).join("\n");
}

function scanBraces(line: string): { open: number; close: number; leadingClose: number } {
  let open = 0;
  let close = 0;
  let leadingClose = 0;
  let leading = true;
  let quote = "";
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (char === "\\") {
        index += 1;
        continue;
      }
      if (char === quote) quote = "";
      continue;
    }
    if (char === "'" || char === "\"" || char === "`") {
      quote = char;
      leading = false;
      continue;
    }
    if (char === "/" && line[index + 1] === "/") break;
    if (char === "#" && leading) break;
    if (char === "{" || char === "(" || char === "[") {
      open += 1;
      leading = false;
      continue;
    }
    if (char === "}" || char === ")" || char === "]") {
      close += 1;
      if (leading) leadingClose += 1;
      continue;
    }
    if (char.trim()) leading = false;
  }
  return { open, close, leadingClose };
}
