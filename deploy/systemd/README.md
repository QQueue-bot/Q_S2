# Sprint 10B - Persistent Runtime Services

## Install service units

```bash
sudo cp /tmp/qs2_review/deploy/systemd/q-s2-webhook.service /etc/systemd/system/
sudo cp /tmp/qs2_review/deploy/systemd/q-s2-tunnel.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable q-s2-webhook q-s2-tunnel
sudo systemctl start q-s2-webhook q-s2-tunnel
```

## Operational commands

```bash
sudo systemctl status q-s2-webhook
sudo systemctl start q-s2-webhook
sudo systemctl stop q-s2-webhook
sudo systemctl restart q-s2-webhook

sudo systemctl status q-s2-tunnel
sudo systemctl start q-s2-tunnel
sudo systemctl stop q-s2-tunnel
sudo systemctl restart q-s2-tunnel
```

## Validation

After both services are running:

```bash
cd /tmp/qs2_review
./scripts/test-public-webhook.sh
```

Expected result: JSON response with `"ok": true`.
