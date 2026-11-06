#!/bin/sh
rm -f /etc/udev/rules.d/99-aula-control.rules
udevadm control --reload-rules 2>/dev/null || true
