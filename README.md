# My Music

Private personal music player for iPhone Safari and Add to Home Screen. Upload your own legally held audio files using the + button. The tracks are stored in IndexedDB on the device and are not sent to this GitHub repository.

## Publish
Enable GitHub Pages in repository Settings > Pages > Build and deployment > Deploy from a branch > main / (root) > Save. The resulting app URL is https://yochevedkolodny.github.io/my-music-web/ . Open in Safari and use Share > Add to Home Screen.

## Limitations
On iPhone web apps, background or locked-screen playback isn't guaranteed across tracks. iOS can evict local IndexedDB data, so retain originals in Files. The app code is public, but music files are never uploaded.
