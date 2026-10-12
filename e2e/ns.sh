#!/bin/bash
# Run a command as the normal user inside the Mullvad network namespace
exec sudo ip netns exec mlvd sudo -u "$USER" env HOME="$HOME" PATH="$PATH" DISPLAY="${DISPLAY:-:99}" "$@"
