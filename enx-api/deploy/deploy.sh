#!/bin/bash

# deploy enx-api to 50.36, run this script on linux or macOS

go version

# Detect platform and set source dir
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    SRC_DIR="/Users/wiloon/workspace/projects/enx/enx-api"
else
    # Linux
    SRC_DIR="/home/wiloon/workspace/enx/enx-api"
fi

# source dir
cd "$SRC_DIR" || exit

package_name="enx-api"
output_dir="build"
mkdir -p "$output_dir"
echo "building"

# sqlite requires the cgo
CGO_ENABLED=1 GOOS=linux GOARCH=amd64 go build -o ${output_dir}/${package_name} enx-api.go

# generate sha256 file
echo "generating sha256 file"
sha256sum ${output_dir}/${package_name} > ${output_dir}/${package_name}.sha256

#echo "after upx"
ls -lh ${output_dir}/${package_name}

echo "stop service"

# deploy to aliyun
#ansible -i 'wiloon.com,' all -m shell -a 'systemctl stop enx-api' -u root --key-file ~/.ssh/id_ed25519_w10n
#scp -i ~/.ssh/id_ed25519_w10n ${package_name} aliyun:/usr/local/bin
#scp -i ~/.ssh/id_ed25519_w10n config-aliyun.toml aliyun:/usr/local/etc/enx-api.toml

# copy systemd unit file
ansible -i '192.168.50.36,' all -m copy -a "src=$SRC_DIR/deploy/enx-api.service dest=/etc/systemd/system/enx-api.service" -u root --key-file ~/.ssh/id_ed25519_w10n
# copy bin
ansible -i '192.168.50.36,' all -m copy -a "src=$SRC_DIR/${output_dir}/${package_name} dest=/usr/local/bin/enx-api" -u root --key-file ~/.ssh/id_ed25519_w10n
# systemd reload
ansible -i '192.168.50.36,' all -m shell -a 'systemctl daemon-reload' -u root --key-file ~/.ssh/id_ed25519_w10n
# copy config file
ansible -i '192.168.50.36,' all -m copy -a "src=$SRC_DIR/config.toml dest=/usr/local/etc/enx/config.toml" -u root --key-file ~/.ssh/id_ed25519_w10n
ansible -i '192.168.50.36,' all -m shell -a 'systemctl stop enx-api' -u root --key-file ~/.ssh/id_ed25519_w10n

ansible -i '192.168.50.36,' all -m file -a 'path=/usr/local/etc/enx/ state=directory mode=0755' -u root --key-file ~/.ssh/id_ed25519_w10n
ansible -i '192.168.50.36,' all -m file -a 'path=/var/lib/enx-api/ state=directory mode=0755' -u root --key-file ~/.ssh/id_ed25519_w10n

echo "start service"

# local server
ansible -i '192.168.50.36,' all  -m shell -a 'systemctl enable enx-api' -u root --key-file ~/.ssh/id_ed25519_w10n
ansible -i '192.168.50.36,' all  -m shell -a 'systemctl restart enx-api' -u root --key-file ~/.ssh/id_ed25519_w10n
