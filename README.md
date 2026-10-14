# My Music

Private personal music player for iPhone Safari and Add to Home Screen. Upload your own legally held audio files using the + button. The tracks are stored in IndexedDB on the device and are not sent to this GitHub repository.

## Publish
Enable GitHub Pages in repository Settings > Pages > Build and deployment > Deploy from a branch > main / (root) > Save. The resulting app URL is https://yochevedkolodny.github.io/my-music-web/ . Open in Safari and use Share > Add to Home Screen.

## Limitations
On iPhone web apps, background or locked-screen playback isn't guaranteed across tracks. iOS can evict local IndexedDB data, so retain originals in Files. The app code is public, but music files are never uploaded.

## Complete library backups
Open Profile → App settings → Backup Library and save the ZIP to Files. New backups use version 3 and include original audio/artwork, song metadata, playlists, artist/profile photos, listening statistics, and all saved My Music preferences, including queue and resume state. Empty-library profile backups are supported. Backup files can contain personal photos; keep them somewhere you trust.

Restore Library accepts versions 1, 2 and 3, keeps existing songs, verifies every ZIP entry before changes, and merges duplicates additively. A successful restore reloads the app with playback paused so old playback events cannot overwrite restored settings. Old version 1/2 exports cannot recover fields that their original exporter left out. Keep your original audio and an independent backup.

To transfer to Music Keeper TestFlight build 6, update this web app at the same address, create a fresh version 3 backup, then use Restore Library in the iPhone app. Safari data does not transfer automatically. Do not delete the web app or clear its website data before verifying the imported library.

The updated backup module is byte-identical to the module validated in Music Keeper native revision 97180717edc4b1fa5e754f707f3f4c1319cfda84. Automated tests cover full backup round trips, legacy files, corruption rejection, exact interface preservation and active-playback restoration.
