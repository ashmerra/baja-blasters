<img src="public/assets/icon-192.png" width="64" height="64" alt="">

# Baja Blasters

**Play: https://ashmerra.github.io/baja-blasters/**

**Part the Red Team.** A portrait-mode phone browser game. You lead the Baja
Blasters (the blue team) through a red sea, using two bottles of Baja Blast to
hold back the water.

## Play

- **Drag** anywhere to steer. Moses sprays nonstop and pushes back the sea near him.
- The **Dew** meter drains over time. When it runs out, the spray gets weak.
  Pick up Baja Blast bottles to refill it.
- Touching the water, or being hit by a Red Team soldier, costs one heart of Faith.
  Stone tablets restore Faith.
- Soldiers beside you get sprayed into the sea. A soldier straight ahead gets through
  unless you dodge, and soldiers that pass you capture your followers.
- Pick up stragglers to grow your line. Every 5 followers adds +1 to the score multiplier.
- Every 5 bottles charges a **BAJA BLAST**. It clears the whole screen.
- Desktop controls: ←/→ or A/D to steer, Space for Blast, Esc/P to pause.

## Deploy

Every push to `main` triggers `.github/workflows/pages.yml`, which publishes
`public/` to GitHub Pages. The page sets its Content-Security-Policy in a
`<meta>` tag, because Pages does not allow custom headers.

## Run locally

Static files live in `public/`. No build step.

```sh
scripts/serve.py --host 127.0.0.1 --port 8790   # local only
scripts/serve-tailscale                          # this machine's Tailscale IPv4 only
```

On this machine, the user service `baja-blasters.service`
(`~/.config/systemd/user/`) runs `scripts/serve-tailscale` on port 8790:

```sh
systemctl --user status baja-blasters.service
systemctl --user restart baja-blasters.service
```

The server sends `Cache-Control: no-cache`, so reloading the page picks up edits.
It also serves only `public/`, never lists directories, and sends security
headers (CSP, nosniff, no-referrer).

### Public URL (Cloudflare quick tunnel)

Two more user services put the game on the internet:

- `baja-blasters-local.service`: `scripts/serve.py` on `127.0.0.1:8791`, the origin the tunnel forwards to.
- `baja-blasters-tunnel.service`: `cloudflared tunnel --url http://127.0.0.1:8791`.
  It connects outbound only, so no inbound ports are opened.

The `*.trycloudflare.com` URL is random and **changes whenever the tunnel restarts**
(including after a reboot). To print the current URL:

```sh
scripts/public-url
```

To take the game offline:

```sh
systemctl --user disable --now baja-blasters-tunnel.service baja-blasters-local.service
```
