# GitHub social preview

GitHub shows this card when someone shares a link to the repository.

- `social-preview.png` is the upload: 2560x1280, a 2x render of the 1280x640
  size that GitHub asks for.
- `social-preview.html` is the source. It uses the dark tokens, Inter, and the
  orange tile mark. `inter.woff2` is the Inter Variable latin subset (OFL-1.1).
- `icons/` holds the real favicons of the saved pieces shown in the list.

To change the card, edit the HTML, then render it with Playwright at a
1280x640 viewport and `deviceScaleFactor: 2`. Wait for `document.fonts.ready`
before the screenshot.

GitHub has no API for the social preview. Upload the PNG in the repository
under Settings > General > Social preview.
