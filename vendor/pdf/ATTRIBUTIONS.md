# PDF browser dependencies

- `pdf-lib.min.js` 1.17.1 — MIT license; see `pdf-lib.LICENSE.md`.
- `fontkit.umd.min.js` 1.1.1 (`@pdf-lib/fontkit`) — MIT license declared by the package; source: https://github.com/Hopding/fontkit

Both files are vendored so government-form generation stays in the browser and does not require a third-party runtime service.

The companion `NotoSansTC-Regular.ttf` is the 400-weight static instance of the official Noto Sans TC variable TTF. It remains under the SIL Open Font License in `reference/government-forms/fonts/NotoSansCJKtc.LICENSE.txt`.
