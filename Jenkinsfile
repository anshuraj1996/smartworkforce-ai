pipeline {
    agent any
    environment {
        IMAGE_TAG = "smartworkforce-backend:jenkins-${BUILD_NUMBER}"
    }
    stages {
        stage('Checkout') {
            steps {
                git branch: 'main', url: 'git@github.com-anshuraj1996:anshuraj1996/smartworkforce-ai.git', credentialsId: 'github-anshuraj1996-ssh'
            }
        }
        stage('Build') {
            steps {
                sh 'docker build -t ${IMAGE_TAG} ./backend'
            }
        }
        stage('Load into minikube') {
            steps {
                sh 'docker save ${IMAGE_TAG} | docker exec -i minikube docker load'
            }
        }
        stage('Deploy') {
            steps {
                sh 'kubectl set image deployment/backend backend=${IMAGE_TAG}'
                sh 'kubectl rollout status deployment/backend --timeout=600s'
            }
        }
    }
    post {
        success {
            echo "Pipeline succeeded - image ${IMAGE_TAG} deployed to minikube"
        }
        failure {
            echo "Pipeline failed - check the stage logs above for details"
        }
        always {
            sh 'docker rmi ${IMAGE_TAG} || true'
        }
    }
}
