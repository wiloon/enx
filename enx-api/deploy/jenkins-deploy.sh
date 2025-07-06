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

# Get version information for build
VERSION=${1:-$(git describe --tags --always --dirty 2>/dev/null || echo "dev")}
GIT_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
GIT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
BUILD_TIME=$(date -u '+%Y-%m-%d_%H:%M:%S_UTC')

echo "Building with version information:"
echo "  Version: $VERSION"
echo "  Git Commit: $GIT_COMMIT"
echo "  Git Branch: $GIT_BRANCH"
echo "  Build Time: $BUILD_TIME"

echo "building"

# sqlite requires the cgo, build with version information
CGO_ENABLED=1 GOPROXY=http://192.168.50.63:4000 go build -v \
    -ldflags "-X enx-server/version.Version=$VERSION \
               -X enx-server/version.GitCommit=$GIT_COMMIT \
               -X enx-server/version.GitBranch=$GIT_BRANCH \
               -X enx-server/version.BuildTime=$BUILD_TIME" \
    -o ${package_name} enx-api.go

ls -lh ${package_name}
md5sum ${package_name}

echo "stop service"

# copy systemd unit file to local server
ls -l ~/.ssh/id_ed25519

deploy_to_target() {

    local target_ip=$1
    ssh_port=1022
    echo "target ip ${target_ip}"

    ssh -o StrictHostKeyChecking=no root@${target_ip} exit

    ansible -i "${target_ip}," all -m ping -u=root -e ansible_ssh_port=${ssh_port}

    ansible -i "${target_ip}," all -m copy -a 'src=/var/lib/jenkins/workspace/enx-api/enx-api/deploy/enx-api.service dest=/etc/systemd/system/enx-api.service' -u=root -e ansible_ssh_port=${ssh_port}
    ansible -i "${target_ip}," all -m shell -a 'systemctl daemon-reload' -u=root -e ansible_ssh_port=${ssh_port}
    ansible -i "${target_ip}," all -m shell -a 'systemctl stop enx-api' -u=root -e ansible_ssh_port=${ssh_port}
    ansible -i "${target_ip}," all -m copy -a "src=${package_name} dest=/usr/local/bin" -u=root -e ansible_ssh_port=${ssh_port}
    ansible -i "${target_ip}," all -m file -a "path=/usr/local/bin/${package_name} mode='u+x'" -u=root -e ansible_ssh_port=${ssh_port}
    ansible -i "${target_ip}," all -m shell -a 'md5sum /usr/local/bin/enx-api' -u=root -e ansible_ssh_port=${ssh_port}

    ansible -i "${target_ip}," all -m file -a 'path=/usr/local/etc/enx/ state=directory mode=0755' -u=root -e ansible_ssh_port=${ssh_port}
    ansible -i "${target_ip}," all -m file -a 'path=/var/lib/enx-api/ state=directory mode=0755' -u=root -e ansible_ssh_port=${ssh_port}

    scp -i ~/.ssh/id_ed25519 -P ${ssh_port} config.toml root@${target_ip}:/usr/local/etc/enx/config.toml

    echo "start service"
    ansible -i "${target_ip}," all  -m shell -a 'systemctl enable enx-api' -u=root -e ansible_ssh_port=${ssh_port}
    ansible -i "${target_ip}," all  -m shell -a 'systemctl start enx-api' -u=root -e ansible_ssh_port=${ssh_port}
    
    # Test version API after deployment
    echo "Testing version API on ${target_ip}:"
    curl -s http://${target_ip}:8080/version | jq '.' || echo "Version API test failed"
    
    # Get and display current deployed version
    echo ""
    echo "=== Current Deployed Version on ${target_ip} ==="
    VERSION_RESPONSE=$(curl -s http://${target_ip}:8080/version 2>/dev/null)
    if [ $? -eq 0 ]; then
        # Extract version using jq if available, otherwise use grep
        if command -v jq >/dev/null 2>&1; then
            DEPLOYED_VERSION=$(echo "$VERSION_RESPONSE" | jq -r '.data.version')
            DEPLOYED_COMMIT=$(echo "$VERSION_RESPONSE" | jq -r '.data.git_commit')
            DEPLOYED_BRANCH=$(echo "$VERSION_RESPONSE" | jq -r '.data.git_branch')
            DEPLOYED_BUILD_TIME=$(echo "$VERSION_RESPONSE" | jq -r '.data.build_time')
            DEPLOYED_UPTIME=$(echo "$VERSION_RESPONSE" | jq -r '.data.uptime')
        else
            # Fallback to grep if jq is not available
            DEPLOYED_VERSION=$(echo "$VERSION_RESPONSE" | grep -o '"version":"[^"]*"' | cut -d'"' -f4)
            DEPLOYED_COMMIT=$(echo "$VERSION_RESPONSE" | grep -o '"git_commit":"[^"]*"' | cut -d'"' -f4)
            DEPLOYED_BRANCH=$(echo "$VERSION_RESPONSE" | grep -o '"git_branch":"[^"]*"' | cut -d'"' -f4)
            DEPLOYED_BUILD_TIME=$(echo "$VERSION_RESPONSE" | grep -o '"build_time":"[^"]*"' | cut -d'"' -f4)
            DEPLOYED_UPTIME=$(echo "$VERSION_RESPONSE" | grep -o '"uptime":"[^"]*"' | cut -d'"' -f4)
        fi
        
        echo "Version: $DEPLOYED_VERSION"
        echo "Commit:  $DEPLOYED_COMMIT"
        echo "Branch:  $DEPLOYED_BRANCH"
        echo "Built:   $DEPLOYED_BUILD_TIME"
        echo "Uptime:  $DEPLOYED_UPTIME"
        echo "✓ Successfully deployed version $DEPLOYED_VERSION to ${target_ip}"
    else
        echo "✗ Failed to retrieve version information from ${target_ip}"
        echo "Response: $VERSION_RESPONSE"
    fi
    echo "================================================"
}

server_host="wiloon.com"
echo "deploy to aws"
deploy_to_target "${server_host}"

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
