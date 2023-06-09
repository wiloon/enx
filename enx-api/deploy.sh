#!/bin/bash
package_name="enx-api"
echo "building"
GOOS=linux GOARCH=amd64 go build -o ${package_name} enx-api.go
echo "stop service"
ansible -i 'wiloon.com,' all  -m shell -a 'systemctl stop enx' -u root
scp ${package_name} -i ~/.ssh/id_ed25519_w10n aliyun:/usr/local/bin
scp config-aliyun.toml -i ~/.ssh/id_ed25519_w10n aliyun:/usr/local/etc/enx-api.toml
rm -f ${package_name}

echo "start service"
ansible -i 'wiloon.com,' all  -m shell -a 'systemctl start enx-api' -u root
