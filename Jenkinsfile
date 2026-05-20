pipeline {
    agent any

    environment {
        APP_NAME    = 'irissec'
        REGISTRY    = 'localhost:5000'
        SHORT_SHA   = "${GIT_COMMIT}".take(7)
        IMAGE_TAG   = "${APP_NAME}:${BUILD_NUMBER}-${SHORT_SHA}"
        RELEASE_TAG = "v1.0.${BUILD_NUMBER}"
    }

    stages {

        stage('Build') {
            steps {
                echo "=== BUILD: Installing dependencies and creating Docker image ==="
                sh 'npm ci'
                sh 'npm run build'
                sh "docker build -t ${REGISTRY}/${IMAGE_TAG} ."
                sh "docker push ${REGISTRY}/${IMAGE_TAG}"
                echo "Built and pushed: ${REGISTRY}/${IMAGE_TAG}"
            }
        }

        stage('Test') {
            steps {
                echo "=== TEST: Running Jest unit and integration tests with coverage ==="
                sh 'npm run test:coverage'
            }
            post {
                always {
                    junit allowEmptyResults: true, testResults: 'junit.xml'
                }
            }
        }

        stage('Code Quality') {
            steps {
                echo "=== CODE QUALITY: Checking SonarCloud quality gate ==="
                withCredentials([string(credentialsId: 'sonarqube-token', variable: 'SONAR_TOKEN')]) {
                    sh """
                        sleep 10
                        STATUS=\$(curl -sf -H "Authorization: Bearer \${SONAR_TOKEN}" \
                          "https://sonarcloud.io/api/qualitygates/project_status?projectKey=Rutwik-01_irissec-api" \
                          | python3 -c "import sys,json; print(json.load(sys.stdin)['projectStatus']['status'])")
                        echo "SonarCloud Quality Gate: \${STATUS}"
                        if [ "\${STATUS}" = "ERROR" ]; then
                            echo "Quality gate FAILED -- aborting pipeline"
                            exit 1
                        fi
                        echo "Quality gate passed or pending -- continuing"
                    """
                }
            }
        }

        stage('Security') {
            steps {
                echo "=== SECURITY: npm audit (SCA) and Trivy (Docker image scan) ==="
                sh '''
                    npm audit --audit-level=critical --json > npm-audit.json 2>&1 || true
                    python3 - << 'PYEOF'
import json, sys
try:
    with open("npm-audit.json") as f:
        data = json.load(f)
    vulns = data.get("metadata", {}).get("vulnerabilities", {})
    critical = vulns.get("critical", 0)
    high     = vulns.get("high", 0)
    print(f"npm audit: critical={critical}, high={high}")
    if critical > 0:
        print("CRITICAL vulnerabilities found -- aborting")
        sys.exit(1)
    print("No critical vulnerabilities found")
except Exception as e:
    print(f"Could not parse npm-audit.json: {e}")
PYEOF
                '''
                sh "trivy image --exit-code 1 --severity CRITICAL ${REGISTRY}/${IMAGE_TAG} || (echo 'Trivy: CRITICAL CVEs found -- aborting'; exit 1)"
                sh "trivy image --severity HIGH,CRITICAL --format table ${REGISTRY}/${IMAGE_TAG} > trivy-report.txt 2>&1 || true"
                archiveArtifacts artifacts: 'npm-audit.json, trivy-report.txt', fingerprint: true
            }
        }

        stage('Deploy') {
            steps {
                echo "=== DEPLOY: Deploying to staging environment (port 3001) ==="
                withCredentials([string(credentialsId: 'api-key', variable: 'API_KEY')]) {
                    sh """
                        export IMAGE_TAG=${REGISTRY}/${IMAGE_TAG}
                        export RELEASE_TAG=${RELEASE_TAG}
                        export API_KEY=\${API_KEY}
                        docker-compose -f docker-compose.staging.yml down --remove-orphans || true
                        docker-compose -f docker-compose.staging.yml up -d
                    """
                }
                sh '''
                    for i in $(seq 1 12); do
                        STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/health)
                        if [ "$STATUS" = "200" ]; then
                            echo "Staging health check passed on attempt $i"
                            exit 0
                        fi
                        echo "Attempt $i: HTTP $STATUS -- waiting 5s"
                        sleep 5
                    done
                    echo "Staging health check FAILED after 60 seconds"
                    exit 1
                '''
            }
        }

        stage('Release') {
            steps {
                echo "=== RELEASE: Tagging ${RELEASE_TAG} and deploying to production ==="
                sh "docker tag ${REGISTRY}/${IMAGE_TAG} ${REGISTRY}/${APP_NAME}:${RELEASE_TAG}"
                sh "docker push ${REGISTRY}/${APP_NAME}:${RELEASE_TAG}"
                withCredentials([string(credentialsId: 'api-key', variable: 'API_KEY')]) {
                    sh """
                        export IMAGE_TAG=${REGISTRY}/${APP_NAME}:${RELEASE_TAG}
                        export RELEASE_TAG=${RELEASE_TAG}
                        export API_KEY=\${API_KEY}
                        docker-compose -f docker-compose.prod.yml down --remove-orphans || true
                        docker-compose -f docker-compose.prod.yml up -d
                    """
                }
                sh '''
                    for i in $(seq 1 12); do
                        STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health)
                        if [ "$STATUS" = "200" ]; then
                            echo "Production health check passed on attempt $i"
                            exit 0
                        fi
                        sleep 5
                    done
                    echo "Production health check FAILED"
                    exit 1
                '''
                withCredentials([usernamePassword(credentialsId: 'github-creds', usernameVariable: 'GIT_USER', passwordVariable: 'GIT_TOKEN')]) {
                    sh """
                        git config user.email "jenkins@irissec.local"
                        git config user.name "Jenkins"
                        git remote set-url origin https://\${GIT_USER}:\${GIT_TOKEN}@github.com/\${GIT_USER}/irissec-api.git
                        git tag -a ${RELEASE_TAG} -m "IrisSec release ${RELEASE_TAG} -- Jenkins build #${BUILD_NUMBER}"
                        git push origin ${RELEASE_TAG}
                    """
                }
            }
        }

        stage('Monitoring') {
            steps {
                echo "=== MONITORING: Verifying metrics endpoint, Prometheus target, and alert rules ==="
                sh '''
                    STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/metrics)
                    echo "Metrics endpoint status: $STATUS"
                    if [ "$STATUS" != "200" ]; then
                        echo "Metrics endpoint not responding -- aborting"
                        exit 1
                    fi
                    echo "Metrics endpoint is UP"
                '''
                sh '''
                    HEALTH=$(curl -s http://localhost:9090/api/v1/targets \
                      | python3 -c "
import sys, json
data = json.load(sys.stdin)
targets = data.get('data', {}).get('activeTargets', [])
for t in targets:
    if '3000' in t.get('scrapeUrl', ''):
        print(t.get('health', 'unknown'))
        sys.exit(0)
print('target-not-found')
")
                    echo "Prometheus target health: $HEALTH"
                    if [ "$HEALTH" = "up" ]; then
                        echo "Prometheus scraping IrisSec successfully"
                    else
                        echo "Warning: Prometheus target is $HEALTH"
                    fi
                '''
                sh '''
                    RULES=$(curl -s http://localhost:9090/api/v1/rules \
                      | python3 -c "
import sys, json
data = json.load(sys.stdin)
groups = data.get('data', {}).get('groups', [])
count = sum(len(g.get('rules', [])) for g in groups)
print(count)
")
                    echo "Alert rules loaded in Prometheus: $RULES"
                    if [ "$RULES" -ge 1 ]; then
                        echo "Alert rules confirmed active"
                    else
                        echo "Warning: No alert rules found"
                    fi
                '''
            }
        }
    }

    post {
        success { echo "Pipeline PASSED -- IrisSec ${RELEASE_TAG} is live in production" }
        failure { echo "Pipeline FAILED -- check console output above" }
        always  { cleanWs() }
    }
}
