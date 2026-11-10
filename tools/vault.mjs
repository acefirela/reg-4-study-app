#!/usr/bin/env node
// Encrypts / decrypts the study content stored in index.html.
//
//   node tools/vault.mjs decrypt <ACCESS-CODE> > content.json     (read the question bank)
//   node tools/vault.mjs encrypt <ACCESS-CODE> content.json       (write it back into index.html)
//
// content.json is { "QUESTIONS": [...], "PROBLEMS": [...] }. It is git-ignored: never commit it.
// Encrypting with a different code changes the access code for everyone.
import { readFileSync, writeFileSync } from "node:fs";
import { webcrypto as crypto } from "node:crypto";

const FILE = new URL("../index.html", import.meta.url);
const ITER = 600000;
const [mode, codeArg, contentPath] = process.argv.slice(2);
if (!["encrypt", "decrypt"].includes(mode) || !codeArg || (mode === "encrypt" && !contentPath)) {
  console.error("usage: vault.mjs decrypt <CODE>  |  vault.mjs encrypt <CODE> <content.json>");
  process.exit(1);
}
const code = codeArg.trim().toUpperCase();
if (code.length !== 8) { console.error("The access code must be 8 characters."); process.exit(1); }

const html = readFileSync(FILE, "utf8");
const RE = /const VAULT = (\{.*\});/;
const b64 = u => Buffer.from(u).toString("base64");
const un64 = s => new Uint8Array(Buffer.from(s, "base64"));

async function aesKey(salt, iter, usage) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode("reg4:" + code), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, base, 256);
  return crypto.subtle.importKey("raw", bits, "AES-GCM", false, [usage]);
}

if (mode === "decrypt") {
  const v = JSON.parse(html.match(RE)[1]);
  try {
    const key = await aesKey(un64(v.salt), v.iter, "decrypt");
    const buf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: un64(v.iv) }, key, un64(v.data));
    process.stdout.write(JSON.stringify(JSON.parse(new TextDecoder().decode(buf)), null, 1) + "\n");
  } catch { console.error("Wrong access code."); process.exit(1); }
} else {
  const c = JSON.parse(readFileSync(contentPath, "utf8"));
  if (!Array.isArray(c.QUESTIONS) || !Array.isArray(c.PROBLEMS)) throw new Error("content needs QUESTIONS and PROBLEMS arrays");
  const ids = new Set();
  for (const x of [...c.QUESTIONS, ...c.PROBLEMS]) {
    if (!x.id || ids.has(x.id)) throw new Error("missing or duplicate id: " + x.id);
    if (!x.source || !x.cat) throw new Error("missing source or cat: " + x.id);
    ids.add(x.id);
  }
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await aesKey(salt, ITER, "encrypt");
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(c)));
  const vault = JSON.stringify({ iter: ITER, salt: b64(salt), iv: b64(iv), data: b64(new Uint8Array(data)) });
  if (!RE.test(html)) throw new Error("VAULT line not found in index.html");
  writeFileSync(FILE, html.replace(RE, () => "const VAULT = " + vault + ";"));
  console.error(`Encrypted ${c.QUESTIONS.length} questions and ${c.PROBLEMS.length} problems into index.html`);
}
