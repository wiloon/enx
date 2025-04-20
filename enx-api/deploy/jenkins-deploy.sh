#!/bin/bash
# deploy script run on jenkins: 192.168.50.37

echo "jenkins deploy script"
echo "jenkins user: $(whoami)"
echo "jenkins home: $HOME"
echo "jenkins pwd: $(pwd)"
echo "jenkins env: $(env)"
echo "jenkins date: $(date)"
go version

# source dir
cd /var/lib/jenkins/workspace/enx-api/enx-api || exit

package_name="enx-api"

echo "git branch:"
git branch --show-current

echo "building"

# sqlite requires the cgo
CGO_ENABLED=1 GOPROXY=http://192.168.50.63:4000 go build -v -o ${package_name} enx-api.go

ls -lh ${package_name}
md5sum ${package_name}

echo "stop service"

# copy systemd unit file to local server
ls -l ~/.ssh/id_ed25519

deploy_to_target() {

    local target_ip=$1
    echo "target ip ${target_ip}"

    ssh -o StrictHostKeyChecking=no root@${target_ip} exit

    ansible -i "${target_ip}," all -m ping -u=root

    ansible -i "${target_ip}," all -m copy -a 'src=/var/lib/jenkins/workspace/enx-api/enx-api/deploy/enx-api.service dest=/etc/systemd/system/enx-api.service' -u=root
    ansible -i "${target_ip}," all -m shell -a 'systemctl daemon-reload' -u=root
    ansible -i "${target_ip}," all -m shell -a 'systemctl stop enx-api' -u=root
    ansible -i "${target_ip}," all -m copy -a "src=${package_name} dest=/usr/local/bin" -u=root
    ansible -i "${target_ip}," all -m file -a "path=/usr/local/bin/${package_name} mode='u+x'" -u=root
    ansible -i "${target_ip}," all -m shell -a 'md5sum /usr/local/bin/enx-api' -u=root

    ansible -i "${target_ip}," all -m file -a 'path=/usr/local/etc/enx/ state=directory mode=0755' -u=root
    ansible -i "${target_ip}," all -m file -a 'path=/var/lib/enx-api/ state=directory mode=0755' -u=root

    scp -i ~/.ssh/id_ed25519 config.toml root@${target_ip}:/usr/local/etc/enx/config.toml

    echo "start service"

    # local server
    ansible -i "${target_ip}," all  -m shell -a 'systemctl enable enx-api' -u=root
    ansible -i "${target_ip}," all  -m shell -a 'systemctl start enx-api' -u=root
}

aws="13.212.34.200"
echo "deploy to aws"
deploy_to_target "${aws}"

# remove local build bin
rm -f ${package_name}

# test api
curl http://${target_ip}:8080/ping

echo "ls"
ls -l /var/lib/jenkins/.cache/go-build
echo "find"
find /var/lib/jenkins/.cache/go-build -mtime +7 -type d -name "*.*"

echo ""
echo "done"
