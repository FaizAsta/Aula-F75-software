#!/bin/sh
# Runs after the .deb is installed: put the udev rule in place and tell udev about it.
set -e
RULE_SRC="/opt/Aula Control/resources/99-aula-control.rules"
if [ -f "$RULE_SRC" ]; then
  install -m 644 "$RULE_SRC" /etc/udev/rules.d/99-aula-control.rules
  udevadm control --reload-rules 2>/dev/null || true
  udevadm trigger --subsystem-match=hidraw 2>/dev/null || true
fi
update-desktop-database /usr/share/applications 2>/dev/null || true
