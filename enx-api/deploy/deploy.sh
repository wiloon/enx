#!/bin/bash

go version

# macos source dir
cd /Users/wiloon/workspace/projects/enx/enx-api || exit

# linux source dir
#cd /home/wiloon/projects/enx/enx-api/ || exit

package_name="enx-api"
echo "building"
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o ${package_name} enx-api.go

#echo "before upx"
#ls -lh ${package_name}
#upx -9 enx-api

#echo "after upx"
ls -lh ${package_name}

echo "stop service"

# deploy to aliyun
#ansible -i 'wiloon.com,' all -m shell -a 'systemctl stop enx-api' -u root --key-file ~/.ssh/id_ed25519_w10n
#scp -i ~/.ssh/id_ed25519_w10n ${package_name} aliyun:/usr/local/bin
#scp -i ~/.ssh/id_ed25519_w10n config-aliyun.toml aliyun:/usr/local/etc/enx-api.toml

# copy systemd unit file to local server
ansible -i '192.168.50.36,' all -m copy -a 'src=/Users/wiloon/workspace/projects/enx/enx-api/deploy/enx-api.service dest=/etc/systemd/system/enx-api.service' -u root --key-file ~/.ssh/id_ed25519_w10n
ansible -i '192.168.50.36,' all -m shell -a 'systemctl daemon-reload' -u root --key-file ~/.ssh/id_ed25519_w10n
ansible -i '192.168.50.36,' all -m shell -a 'systemctl stop enx-api' -u root --key-file ~/.ssh/id_ed25519_w10n
scp -i ~/.ssh/id_ed25519_w10n ${package_name} root@192.168.50.36:/usr/local/bin

ansible -i '192.168.50.36,' all -m file -a 'path=/usr/local/etc/enx/ state=directory mode=0755' -u root --key-file ~/.ssh/id_ed25519_w10n
scp -i ~/.ssh/id_ed25519_w10n config-aliyun.toml root@192.168.50.36:/usr/local/etc/enx/config.toml

# remove local build bin
rm -f ${package_name}

echo "start service"

# aliyun
#ansible -i 'wiloon.com,' all  -m shell -a 'systemctl restart enx-api' -u root --key-file ~/.ssh/id_ed25519_w10n
# local server
ansible -i '192.168.50.36,' all  -m shell -a 'systemctl enable enx-api' -u root --key-file ~/.ssh/id_ed25519_w10n
ansible -i '192.168.50.36,' all  -m shell -a 'systemctl restart enx-api' -u root --key-file ~/.ssh/id_ed25519_w10n
