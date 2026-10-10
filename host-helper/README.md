# arrdeck host helper

A tiny HTTP service on the Mac that lets arrdeck restart (or `up -d`) a fixed
list of docker compose projects. arrdeck is public at deck.thrawn.dk, so it must
never hold the docker socket; this helper is the narrow alternative:

- listens on **127.0.0.1 only** — containers reach it at
  `http://host.docker.internal:8790`, the LAN cannot;
- every request needs `Authorization: Bearer <token>`; the token file must be
  mode 0600 and owned by you, or the helper refuses to start;
- only projects named in the config, only `restart` and `up -d`, at most one
  action per project per 60 s; never a shell.

With `--boot` (as the LaunchAgent runs it) it also fixes the reboot problem:
Docker starts before `/Volumes/Data` is mounted and the containers exit with
"mkdir /Volumes/Data: permission denied". The helper waits for the volume (up
to 15 min) and for Docker, then runs `docker compose up -d` in every listed
project whose containers are not all running. Note that this includes a
project you stopped on purpose, whenever the helper itself (re)starts.

Endpoints: `GET /health`, `GET /projects`, `POST /projects/<name>/restart`,
`POST /projects/<name>/up`.

## Install

Everything below runs as your own user; nothing needs sudo.

1. Create the token (arrdeck needs the same value later):

   ```sh
   mkdir -p ~/.config/arrdeck-helper
   (umask 077; openssl rand -hex 32 > ~/.config/arrdeck-helper/token)
   chmod 600 ~/.config/arrdeck-helper/token
   ```

2. Write `~/.config/arrdeck-helper/config.json`. A project's name must equal
   the arrdeck service name for arrdeck to offer a Restart button on that
   service; other names (like `arrdeck` itself) are still listed and
   restartable from Settings → System.

   ```json
   {
     "port": 8790,
     "docker": "/usr/local/bin/docker",
     "wait_for": "/Volumes/Data",
     "projects": {
       "radarr": "/Volumes/Data/docker/radarr",
       "sonarr": "/Volumes/Data/docker/sonarr",
       "readarr": "/Volumes/Data/docker/readarr",
       "prowlarr": "/Volumes/Data/docker/prowlarr",
       "bazarr": "/Volumes/Data/docker/bazarr",
       "overseerr": "/Volumes/Data/docker/overseerr",
       "arrdeck": "/Volumes/Data/docker/arrdeck"
     }
   }
   ```

   qBittorrent, Transmission and gluetun share the `glue_torrent` project, so
   restarting one restarts all of them (and dispatcharr). To offer that anyway,
   add e.g. `"qbittorrent": "/Volumes/Data/docker/glue_torrent"` — knowing what
   it takes down. Plex runs natively, not in Docker, and cannot be listed.

3. Try it in the foreground first (Ctrl-C to stop):

   ```sh
   /opt/homebrew/bin/python3 /Volumes/Data/docker/arrdeck/host-helper/arrdeck_helper.py
   # in another terminal:
   curl -H "Authorization: Bearer $(cat ~/.config/arrdeck-helper/token)" http://127.0.0.1:8790/projects
   ```

4. Install the LaunchAgent (the plist's log path assumes `/Users/mokk`):

   ```sh
   cp /Volumes/Data/docker/arrdeck/host-helper/dk.thrawn.arrdeck-helper.plist ~/Library/LaunchAgents/
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/dk.thrawn.arrdeck-helper.plist
   launchctl print gui/$(id -u)/dk.thrawn.arrdeck-helper | grep -E 'state|pid'
   tail -f ~/Library/Logs/arrdeck-helper.log
   ```

   The script lives on `/Volumes/Data`; after a reboot launchd cannot start it
   until the volume is mounted, and KeepAlive retries every 30 s until it is.

5. Tell arrdeck: Settings → Connections → **Host helper**. Leave the URL empty
   for `http://host.docker.internal:8790` (or enter it), paste the contents of
   `~/.config/arrdeck-helper/token` as the API key, Save, then Test. Settings →
   System then shows the projects with a Restart button.

After editing the config or the token, restart the helper:

```sh
launchctl kickstart -k gui/$(id -u)/dk.thrawn.arrdeck-helper
```

## Uninstall

```sh
launchctl bootout gui/$(id -u)/dk.thrawn.arrdeck-helper
rm ~/Library/LaunchAgents/dk.thrawn.arrdeck-helper.plist
rm -r ~/.config/arrdeck-helper            # token and config
rm ~/Library/Logs/arrdeck-helper.log
```

Then clear the Host helper connection in arrdeck's Settings → Connections.

## Tests

`backend/tests/test_host_helper.py` loads the script by path and runs with the
backend's test suite; it never calls docker.
