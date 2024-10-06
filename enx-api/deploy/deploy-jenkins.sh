#!/bin/bash
whoami
go version

# source dir
cd /var/lib/jenkins/workspace/enx-api/enx-api || exit

package_name="enx-api"
echo "building"

# sqlite requires the cgo
CGO_ENABLED=1 go build -o ${package_name} enx-api.go

ls -lh ${package_name}

echo "stop service"

# copy systemd unit file to local server
ls -l /root/.ssh/id_ed25519
ansible -i '192.168.50.36,' all -m copy -a 'src=/var/lib/jenkins/workspace/enx-api/enx-api/deploy/enx-api.service dest=/etc/systemd/system/enx-api.service' -u root --key-file /root/.ssh/id_ed25519
ansible -i '192.168.50.36,' all -m shell -a 'systemctl daemon-reload' -u root --key-file /root/.ssh/id_ed25519
ansible -i '192.168.50.36,' all -m shell -a 'systemctl stop enx-api' -u root --key-file /root/.ssh/id_ed25519
scp -i /root/.ssh/id_ed25519 ${package_name} root@192.168.50.36:/usr/local/bin

ansible -i '192.168.50.36,' all -m file -a 'path=/usr/local/etc/enx/ state=directory mode=0755' -u root --key-file /root/.ssh/id_ed25519
ansible -i '192.168.50.36,' all -m file -a 'path=/var/lib/enx-api/ state=directory mode=0755' -u root --key-file /root/.ssh/id_ed25519

scp -i /root/.ssh/id_ed25519 config.toml root@192.168.50.36:/usr/local/etc/enx/config.toml

# remove local build bin
rm -f ${package_name}

echo "start service"

# local server
ansible -i '192.168.50.36,' all  -m shell -a 'systemctl enable enx-api' -u root --key-file /root/.ssh/id_ed25519
ansible -i '192.168.50.36,' all  -m shell -a 'systemctl restart enx-api' -u root --key-file /root/.ssh/id_ed25519
