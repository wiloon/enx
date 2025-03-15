#!/bin/bash

# run on macos, deploy to LAN/local server, cross compile not work

# print go version
go version

# cd to source dir
# macos source dir
cd /Users/wiloon/workspace/projects/enx/enx-api || exit

package_name="enx-api"
echo "building"

# sqlite requires the cgo
GOOS=linux GOARCH=amd64 CGO_ENABLED=1 CC=x86_64-linux-musl-gcc go build -v -o ${package_name} enx-api.go

ls -lh ${package_name}
md5sum ${package_name}

echo "stop service"

# copy systemd unit file
ansible -i '192.168.50.36,' all -m copy -a 'src=/Users/wiloon/workspace/projects/enx/enx-api/deploy/enx-api.service dest=/etc/systemd/system/enx-api.service' -u root --key-file ~/.ssh/id_ed25519
# systemd daemon-reload
ansible -i '192.168.50.36,' all -m shell -a 'systemctl daemon-reload' -u root --key-file ~/.ssh/id_ed25519
# stop service
ansible -i '192.168.50.36,' all -m shell -a 'systemctl stop enx-api' -u root --key-file ~/.ssh/id_ed25519
# copy bin
scp -i ~/.ssh/id_ed25519 ${package_name} root@192.168.50.36:/usr/local/bin
# create dir
ansible -i '192.168.50.36,' all -m file -a 'path=/usr/local/etc/enx/ state=directory mode=0755' -u root --key-file ~/.ssh/id_ed25519
ansible -i '192.168.50.36,' all -m file -a 'path=/var/lib/enx-api/ state=directory mode=0755' -u root --key-file ~/.ssh/id_ed25519

# copy config
scp -i ~/.ssh/id_ed25519 config.toml root@192.168.50.36:/usr/local/etc/enx/config.toml

# remove local build bin
rm -f ${package_name}

echo "start service"

# local server
ansible -i '192.168.50.36,' all  -m shell -a 'systemctl enable enx-api' -u root --key-file ~/.ssh/id_ed25519
ansible -i '192.168.50.36,' all  -m shell -a 'systemctl restart enx-api' -u root --key-file ~/.ssh/id_ed25519

# test api
curl https://enx.wiloon.com/ping

echo ""
echo "done"
