#!/usr/bin/env python3
"""Mullvad WireGuard inside a network namespace only (never touches the default netns routes).

usage: tunnel.py up [relay-prefix] | down | deregister | status
Secrets: account number read from .env, never printed. Key + device id kept in wg/ (chmod 600).
"""
import json, os, subprocess, sys, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
WG_DIR = os.path.join(HERE, 'wg')
NS = 'mlvd'
API = 'https://api.mullvad.net'


def account():
    for line in open(os.path.join(HERE, '.env')):
        if line.startswith('MULLVAD_ACCOUNT='):
            return line.split('=', 1)[1].strip()
    sys.exit('MULLVAD_ACCOUNT missing in .env')


def api(method, path, body=None, token=None):
    req = urllib.request.Request(API + path, method=method)
    req.add_header('Content-Type', 'application/json')
    if token:
        req.add_header('Authorization', f'Bearer {token}')
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data, timeout=30) as r:
            raw = r.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        # error bodies don't contain the account number
        sys.exit(f'API {method} {path} failed: {e.code} {e.read().decode()[:300]}')


def token():
    return api('POST', '/auth/v1/token', {'account_number': account()})['access_token']


def sh(cmd, **kw):
    return subprocess.run(cmd, shell=True, check=True, text=True, **kw)


def save(name, content):
    os.makedirs(WG_DIR, mode=0o700, exist_ok=True)
    path = os.path.join(WG_DIR, name)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as f:
        f.write(content)
    return path


def device():
    path = os.path.join(WG_DIR, 'device.json')
    if os.path.exists(path):
        return json.load(open(path))
    priv = subprocess.check_output(['wg', 'genkey'], text=True).strip()
    pub = subprocess.check_output(['wg', 'pubkey'], input=priv, text=True).strip()
    save('private.key', priv)
    dev = api('POST', '/accounts/v1/devices', {'pubkey': pub, 'hijack_dns': False}, token())
    info = {k: dev[k] for k in ('id', 'name', 'pubkey', 'ipv4_address', 'ipv6_address')}
    save('device.json', json.dumps(info, indent=2))
    print(f"registered device {info['name']} ({info['ipv4_address']})")
    return info


def up(prefix='se-'):
    dev = device()
    relays = api('GET', '/app/v1/relays')['wireguard']['relays']
    relay = next(r for r in relays if r['hostname'].startswith(prefix) and r.get('active'))
    print(f"relay {relay['hostname']} {relay['ipv4_addr_in']}")
    down(quiet=True)
    priv = os.path.join(WG_DIR, 'private.key')
    sh(f'sudo ip netns add {NS}')
    # Created in the default netns (so its UDP socket uses the orb's normal uplink), then moved.
    sh(f'sudo ip link add wg-{NS} type wireguard')
    sh(f'sudo ip link set wg-{NS} netns {NS}')
    sh(
        f"sudo ip netns exec {NS} wg set wg-{NS} private-key {priv} peer {relay['public_key']} "
        f"endpoint {relay['ipv4_addr_in']}:51820 allowed-ips 0.0.0.0/0,::/0"
    )
    sh(f"sudo ip -n {NS} addr add {dev['ipv4_address']} dev wg-{NS}")
    sh(f'sudo ip -n {NS} link set lo up')
    sh(f'sudo ip -n {NS} link set wg-{NS} up')
    sh(f'sudo ip -n {NS} route add default dev wg-{NS}')
    sh(f'sudo mkdir -p /etc/netns/{NS}')
    sh(f"echo 'nameserver 10.64.0.1' | sudo tee /etc/netns/{NS}/resolv.conf >/dev/null")
    save('relay.json', json.dumps({'hostname': relay['hostname']}))


def down(quiet=False):
    r = subprocess.run(f'sudo ip netns del {NS}', shell=True, capture_output=True)
    if not quiet:
        print('namespace removed' if r.returncode == 0 else 'namespace not present')


def deregister():
    path = os.path.join(WG_DIR, 'device.json')
    if not os.path.exists(path):
        print('no registered device')
        return
    dev = json.load(open(path))
    api('DELETE', f"/accounts/v1/devices/{dev['id']}", token=token())
    os.remove(path)
    print(f"deregistered device {dev['name']}")


def status():
    sh(f'sudo ip netns exec {NS} wg show wg-{NS} | grep -E "endpoint|handshake|transfer"')


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'status'
    {'up': lambda: up(*sys.argv[2:]), 'down': down, 'deregister': deregister, 'status': status}[cmd]()
