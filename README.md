# Reg-4 Study App

A single-page, mobile-friendly study app for the LAFD Regulation 4 certification exams
(Pressurized Stair Shaft, Standpipe and Sprinkler, Supervising Station Alarm, General Reg-4).

- Everything the phone needs is in `index.html`. No build step, no login, progress is saved on the device.
- The question bank in `index.html` is encrypted with the 8-character access code. It cannot be
  read from the page source without the code. The code is not stored in this repo.
- Questions are practice questions written from the company study packs (LAFD Reg-4 manual 2014,
  Study Reference Table, F-340R forms). They are not real exam questions. Each one shows its source.

## Editing the questions

Needs Node.js 18 or newer.

    node tools/vault.mjs decrypt <ACCESS-CODE> > content.json
    # edit content.json
    node tools/vault.mjs encrypt <ACCESS-CODE> content.json
    # commit index.html only

`content.json` is git-ignored. Never commit it or paste plain questions into `index.html`.
Encrypting with a different code changes the access code for everyone.

## Hosting

Settings → Pages → Deploy from a branch → `main` / `/ (root)`.
