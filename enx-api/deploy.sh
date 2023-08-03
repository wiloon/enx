#!/bin/bash
# macos path
cd /Users/wiloon/workspace/projects/enx/enx-api || exit
# cd /home/wiloon/projects/enx/enx-api/ || exit
package_name="enx-api"
echo "building"
GOOS=linux GOARCH=amd64 go build -o ${package_name} enx-api.go

echo "before upx"
ls -lh ${package_name}
upx -9 enx-api

echo "after upx"
ls -lh ${package_name}

echo "stop service"
ansible -i 'wiloon.com,' all -m shell -a 'systemctl stop enx-api' -u root --key-file ~/.ssh/id_ed25519_w10n
scp -i ~/.ssh/id_ed25519_w10n ${package_name} aliyun:/usr/local/bin
scp -i ~/.ssh/id_ed25519_w10n config-aliyun.toml aliyun:/usr/local/etc/enx-api.toml
rm -f ${package_name}

echo "start service"
ansible -i 'wiloon.com,' all  -m shell -a 'systemctl restart enx-api' -u root --key-file ~/.ssh/id_ed25519_w10n
