#!/usr/bin/env node
// Encrypts / decrypts the study content stored in index.html.
//
//   node tools/vault.mjs decrypt <ACCESS-CODE> > content.json     (read the question bank)
//   node tools/vault.mjs encrypt <ACCESS-CODE> content.json       (write it back into index.html)
//   node tools/vault.mjs encrypt-file <ACCESS-CODE> guide.mp3 audio/guide.bin   (encrypt an audio guide)
//   node tools/vault.mjs decrypt-file <ACCESS-CODE> audio/guide.bin guide.mp3   (get the MP3 back)
//
// content.json is { "QUESTIONS": [...], "PROBLEMS": [...], "AUDIO": [...] }. It is git-ignored:
// never commit it, and never commit plain MP3 files.
// Changing the access code: decrypt everything with the old code first (content and audio), then
// run "encrypt --new-salt" with the new code and encrypt-file every audio guide again.
import { readFileSync, writeFileSync } from "node:fs";
import { webcrypto as crypto } from "node:crypto";

const FILE = new URL("../index.html", import.meta.url);
const ITER = 600000;
const args = process.argv.slice(2).filter(a => a !== "--new-salt");
const newSalt = process.argv.includes("--new-salt");
const [mode, codeArg, contentPath, outPath] = args;
const need = { decrypt: 2, encrypt: 3, "encrypt-file": 4, "decrypt-file": 4 }[mode];
if (!need || args.length < need) {
  console.error("usage: vault.mjs decrypt <CODE> | encrypt <CODE> <content.json> [--new-salt] | encrypt-file <CODE> <in> <out> | decrypt-file <CODE> <in> <out>");
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

const current = JSON.parse(html.match(RE)[1]);
if (mode === "encrypt-file") {
  // file layout: 12-byte iv, then AES-GCM ciphertext. Uses the same key as the question bank.
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await aesKey(un64(current.salt), current.iter, "encrypt");
  await aesKey(un64(current.salt), current.iter, "decrypt").then(k => crypto.subtle.decrypt({ name: "AES-GCM", iv: un64(current.iv) }, k, un64(current.data)))
    .catch(() => { console.error("Wrong access code."); process.exit(1); });
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, readFileSync(contentPath)));
  writeFileSync(outPath, Buffer.concat([iv, data]));
  console.error(`Encrypted ${contentPath} -> ${outPath}`);
} else if (mode === "decrypt-file") {
  const buf = readFileSync(contentPath);
  try {
    const key = await aesKey(un64(current.salt), current.iter, "decrypt");
    writeFileSync(outPath, new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.subarray(0, 12) }, key, buf.subarray(12))));
  } catch { console.error("Wrong access code."); process.exit(1); }
} else if (mode === "decrypt") {
  const v = current;
  try {
    const key = await aesKey(un64(v.salt), v.iter, "decrypt");
    const buf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: un64(v.iv) }, key, un64(v.data));
    process.stdout.write(JSON.stringify(JSON.parse(new TextDecoder().decode(buf)), null, 1) + "\n");
  } catch { console.error("Wrong access code."); process.exit(1); }
} else {
  const c = JSON.parse(readFileSync(contentPath, "utf8"));
  if (!Array.isArray(c.QUESTIONS) || !Array.isArray(c.PROBLEMS)) throw new Error("content needs QUESTIONS and PROBLEMS arrays");
  const ids = new Set();
  c.AUDIO = c.AUDIO || [];
  for (const x of [...c.QUESTIONS, ...c.PROBLEMS]) {
    if (!x.id || ids.has(x.id)) throw new Error("missing or duplicate id: " + x.id);
    if (!x.source || !x.cat) throw new Error("missing source or cat: " + x.id);
    ids.add(x.id);
  }
  // Keep the existing salt so the key (and the encrypted audio files) stay valid for the same code.
  const salt = (!newSalt && current.salt) ? un64(current.salt) : crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await aesKey(salt, ITER, "encrypt");
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(c)));
  const vault = JSON.stringify({ iter: ITER, salt: b64(salt), iv: b64(iv), data: b64(new Uint8Array(data)) });
  if (!RE.test(html)) throw new Error("VAULT line not found in index.html");
  writeFileSync(FILE, html.replace(RE, () => "const VAULT = " + vault + ";"));
  console.error(`Encrypted ${c.QUESTIONS.length} questions and ${c.PROBLEMS.length} problems into index.html`);
}
