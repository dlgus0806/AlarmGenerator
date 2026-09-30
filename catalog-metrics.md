# 알람 지표 카탈로그

> 이 문서는 `src/catalog/*.json` 에서 자동 생성됩니다. **직접 고치지 마세요.**
> 지표를 추가/수정하려면 아래 "파일 위치"의 JSON을 편집하고 `npm run docs`로 이 문서를 다시 생성하세요.

생성 시각: 2026-09-30T06:42:41.038Z

## 파일 위치

| 리소스 | 파일 |
|---|---|
| EC2 인스턴스 | `src/catalog/ec2.json` |
| Auto Scaling 그룹 | `src/catalog/asg.json` |
| ALB (Application Load Balancer) | `src/catalog/alb.json` |
| 로드 밸런서 대상 그룹 (ALB) | `src/catalog/target-group.json` |
| ECS 서비스 | `src/catalog/ecs.json` |
| Lambda 함수 | `src/catalog/lambda.json` |
| CloudFront 배포 | `src/catalog/cloudfront.json` |
| Aurora PostgreSQL | `src/catalog/aurora-postgresql.json` |
| Aurora MySQL | `src/catalog/aurora-mysql.json` |
| RDS PostgreSQL | `src/catalog/rds-postgresql.json` |
| RDS MySQL | `src/catalog/rds-mysql.json` |
| RDS MariaDB | `src/catalog/rds-mariadb.json` |
| RDS Oracle | `src/catalog/rds-oracle.json` |
| RDS SQL Server | `src/catalog/rds-sqlserver.json` |
| 계정 보안 (CloudTrail) | `src/catalog/account-security.json` |
| (리소스 등록) | `src/catalog/index.ts` |

## 컬럼 의미

- **N/M**: N=평가 구간 수(evaluationPeriods), M=그중 위반이면 알람인 개수(datapointsToAlarm)
- **결측**: treatMissingData (breaching / notBreaching / ignore / missing)
- **기본**: 리소스 추가 시 기본으로 켜지는지 (defaultOn)
- **임계값 단위**: percent=%, gib=GiB(내부에서 바이트로 변환), 그 외 raw

## EC2 인스턴스

- 리소스 키: `ec2`
- 기본 디멘션: `InstanceId`
- 파일: `src/catalog/ec2.json`

| 지표 | metricName | 통계 | period | N/M | 연산 | 임계값 | 결측 | 기본 | 배지 |
|---|---|---|---|---|---|---|---|---|---|
| CPU 사용률 높음 | `CPUUtilization` | Average | 300s | 1/1 | >= | 80% | missing | ● | 기본, Lv1/2/3 |
| 인스턴스 상태 검사 실패 | `StatusCheckFailed_Instance` | Maximum | 60s | 1/1 | >= | 1 | missing |  | 기본 |
| 시스템 상태 검사 실패 | `StatusCheckFailed_System` | Maximum | 60s | 1/1 | >= | 1 | missing |  | 기본 |
| CPU 크레딧 부족 | `CPUCreditBalance` | Minimum | 300s | 1/1 | <= | 20 | missing |  | T 계열 전용 |
| EBS IO 버스트 잔량 부족 | `EBSIOBalance%` | Minimum | 300s | 1/1 | <= | 20% | missing |  | Nitro 전용 |
| 메모리 사용률 높음 | `mem_used_percent` | Average | 300s | 1/1 | >= | 85% | missing | ● | 에이전트 필요, Lv1/2/3 |
| 디스크 사용률 높음 | `disk_used_percent` | Average | 300s | 1/1 | >= | 85% | missing | ● | 에이전트 필요, Lv1/2/3 |

참고:
- **CPU 사용률 높음**: Amazon EC2에서 EC2 인스턴스 실행에 사용하는 물리적 CPU 시간의 비율입니다.
- **인스턴스 상태 검사 실패**: 인스턴스가 마지막으로 인스턴스 상태 확인을 통과했는지 여부를 보고합니다.
- **시스템 상태 검사 실패**: 인스턴스가 마지막으로 모든 상태 확인을 통과했는지 여부를 보고합니다.
- **CPU 크레딧 부족**: T2/T3/T4g 인스턴스에만 존재합니다. 시작 이후 인스턴스가 누적한 획득 CPU 크레딧 수입니다.
- **EBS IO 버스트 잔량 부족**: 버스트 버킷에 남아 있는 I/O 크레딧의 비율에 대한 정보를 제공합니다.
- **메모리 사용률 높음**: 현재 사용 중인 메모리 비율입니다. 지표 확인을 위해서는 CloudWatch Agent 설치가 필요합니다.
- **디스크 사용률 높음**: 사용된 총 디스크 공간 비율입니다. 에이전트 설정에 따라 device / fstype 디멘션이 추가로 필요할 수 있습니다.

## Auto Scaling 그룹

- 리소스 키: `asg`
- 기본 디멘션: `AutoScalingGroupName`
- 파일: `src/catalog/asg.json`

| 지표 | metricName | 통계 | period | N/M | 연산 | 임계값 | 결측 | 기본 | 배지 |
|---|---|---|---|---|---|---|---|---|---|
| 그룹 평균 CPU 사용률 높음 | `CPUUtilization` | Average | 300s | 1/1 | >= | 80% | missing | ● | 기본, Lv1/2/3 |
| 서비스 중 인스턴스 부족 | `GroupInServiceInstances` | Average | 60s | 10/10 | < | 1 | missing |  | 그룹 지표 수집 필요 |
| 그룹 내 상태 검사 실패 | `StatusCheckFailed` | Maximum | 60s | 2/2 | >= | 1 | missing |  |  |

참고:
- **그룹 평균 CPU 사용률 높음**: 그룹에 속한 인스턴스 전체의 평균 CPU입니다. EC2 지표의 AutoScalingGroupName 디멘션은 기본 모니터링에서도 제공됩니다.
- **서비스 중 인스턴스 부족**: 그룹의 '그룹 지표 수집'을 켜야 데이터가 생깁니다. 임계값은 워크로드에 필요한 최소 인스턴스 수(보통 원하는 용량)로 맞추세요. 기본 1은 서비스 중 인스턴스가 0이 되면 울립니다.
- **그룹 내 상태 검사 실패**: 그룹 안 인스턴스 중 하나라도 상태 검사에 실패하면 울립니다.

## ALB (Application Load Balancer)

- 리소스 키: `alb`
- 기본 디멘션: `LoadBalancer`
- 파일: `src/catalog/alb.json`

| 지표 | metricName | 통계 | period | N/M | 연산 | 임계값 | 결측 | 기본 | 배지 |
|---|---|---|---|---|---|---|---|---|---|
| ELB 5xx 응답 | `HTTPCode_ELB_5XX_Count` | Sum | 300s | 1/1 | > | 10 | missing | ● | 기본 |
| 타깃 5xx 응답 | `HTTPCode_Target_5XX_Count` | Sum | 300s | 1/1 | > | 20 | missing | ● | 기본 |
| 응답 시간 p99 높음 | `TargetResponseTime` | p99 (백분위) | 300s | 1/1 | > | 2초 | missing |  | 기본 |
| 비정상 타깃 존재 | `UnHealthyHostCount` | Maximum | 60s | 1/1 | >= | 1 | missing |  | 기본 |
| 연결 거부 발생 | `RejectedConnectionCount` | Sum | 300s | 1/1 | > | 0 | missing |  |  |
| 타깃 연결 오류 | `TargetConnectionErrorCount` | Sum | 300s | 1/1 | > | 10 | missing |  |  |

참고:
- **ELB 5xx 응답**: ALB 자체가 5xx를 반환한 경우입니다. 타깃 문제와 구분됩니다.
- **연결 거부 발생**: ALB 동시 연결 한도 초과입니다. 0을 넘기면 이미 요청이 버려지고 있습니다.

## 로드 밸런서 대상 그룹 (ALB)

- 리소스 키: `target-group`
- 기본 디멘션: `TargetGroup`
- 파일: `src/catalog/target-group.json`

| 지표 | metricName | 통계 | period | N/M | 연산 | 임계값 | 결측 | 기본 | 배지 |
|---|---|---|---|---|---|---|---|---|---|
| 비정상 대상 존재 | `UnHealthyHostCount` | Minimum | 60s | 2/2 | >= | 1 | missing | ● | 기본 |
| 정상 대상 없음 | `HealthyHostCount` | Minimum | 60s | 2/2 | < | 1 | missing | ● | 기본 |
| 대상 5xx 응답 | `HTTPCode_Target_5XX_Count` | Sum | 300s | 1/1 | > | 20 | notBreaching |  |  |
| 대상 응답 시간 p99 높음 | `TargetResponseTime` | p99 (백분위) | 300s | 1/1 | > | 2초 | notBreaching |  |  |
| 대상 연결 오류 | `TargetConnectionErrorCount` | Sum | 300s | 1/1 | > | 10 | notBreaching |  |  |

참고:
- **비정상 대상 존재**: Minimum 통계는 모든 로드 밸런서 노드가 비정상으로 볼 때만 잡혀 오탐이 적습니다. 두 번 연속일 때 울립니다.
- **정상 대상 없음**: 정상 대상이 1개 미만(0개)이면 울립니다. 최소로 유지해야 할 대상 수로 올려도 됩니다.
- **대상 5xx 응답**: 트래픽이 없으면 데이터가 없으므로 결측을 양호로 봅니다. 평균 트래픽의 5% 정도에서 시작해 조정하세요.
- **대상 연결 오류**: 대상이 Lambda 함수인 대상 그룹에는 이 지표가 없습니다.

## ECS 서비스

- 리소스 키: `ecs`
- 기본 디멘션: `ServiceName`
- 파일: `src/catalog/ecs.json`

| 지표 | metricName | 통계 | period | N/M | 연산 | 임계값 | 결측 | 기본 | 배지 |
|---|---|---|---|---|---|---|---|---|---|
| 서비스 CPU 사용률 높음 | `CPUUtilization` | Average | 60s | 5/5 | >= | 80% | missing | ● | 기본, Lv1/2/3 |
| 서비스 메모리 사용률 높음 | `MemoryUtilization` | Average | 60s | 5/5 | >= | 80% | missing | ● | 기본, Lv1/2/3 |
| 실행 중 태스크 없음 | `RunningTaskCount` | Average | 60s | 5/5 | <= | 0 | missing |  | Container Insights 필요 |

참고:
- **서비스 CPU 사용률 높음**: 태스크 정의에 잡은 CPU 대비 사용률이라 100%를 넘을 수 있습니다. 배포 중이 아닌데 계속 높으면 CPU 한도를 늘리세요.
- **서비스 메모리 사용률 높음**: 태스크 정의에 잡은 메모리 대비 사용률이라 100%를 넘을 수 있습니다.
- **실행 중 태스크 없음**: 클러스터에 Container Insights를 켜야 데이터가 생깁니다. 0이면 서비스가 중단된 상태입니다. 최소 실행 태스크 수에 맞춰 임계값을 올려도 됩니다.

## Lambda 함수

- 리소스 키: `lambda`
- 기본 디멘션: `FunctionName`
- 파일: `src/catalog/lambda.json`

| 지표 | metricName | 통계 | period | N/M | 연산 | 임계값 | 결측 | 기본 | 배지 |
|---|---|---|---|---|---|---|---|---|---|
| 함수 오류 | `Errors` | Sum | 300s | 1/1 | > | 1 | missing | ● | 기본 |
| 스로틀 | `Throttles` | Sum | 300s | 1/1 | > | 1 | missing | ● | 기본 |
| 실행 시간 (p99) | `Duration` | p99 (백분위) | 300s | 1/1 | > | 3000 | missing | ● | p99 |
| 동시 실행 수 | `ConcurrentExecutions` | Maximum | 300s | 1/1 | >= | 900 | missing |  | 동시성 |

참고:
- **함수 오류**: 함수 실행 오류 건수입니다. 호출이 없으면 데이터가 없어 INSUFFICIENT_DATA일 수 있습니다.
- **스로틀**: 동시성 한도로 요청이 스로틀된 횟수입니다.
- **실행 시간 (p99)**: 함수 실행 시간(p99, 밀리초). 타임아웃 설정에 근접하는지 확인하세요.
- **동시 실행 수**: 예약/계정 동시성 한도에 근접하는지 확인합니다.

## CloudFront 배포

- 리소스 키: `cloudfront`
- 기본 디멘션: `DistributionId`
- 파일: `src/catalog/cloudfront.json`

| 지표 | metricName | 통계 | period | N/M | 연산 | 임계값 | 결측 | 기본 | 배지 |
|---|---|---|---|---|---|---|---|---|---|
| 5xx 오류율 높음 | `5xxErrorRate` | Average | 60s | 5/5 | > | 5% | notBreaching | ● | 기본, us-east-1 |
| 4xx 오류율 높음 | `4xxErrorRate` | Average | 60s | 5/5 | > | 10% | notBreaching |  | us-east-1 |
| 오리진 응답 지연 높음 (p90) | `OriginLatency` | p90 (백분위) | 60s | 5/5 | > | 24000ms | notBreaching |  | 추가 지표(유료), us-east-1 |

참고:
- **5xx 오류율 높음**: 전체 요청 중 5xx 비율(%)입니다. 일시적 오류로 울리지 않도록 0보다 큰 값으로 두세요.
- **4xx 오류율 높음**: 클라이언트 오류 비율(%)입니다. 봇·잘못된 링크로도 오르므로 평소 수준을 보고 정하세요.
- **오리진 응답 지연 높음 (p90)**: 배포의 '추가 지표'를 켜야 데이터가 생깁니다(추가 요금). 오리진 응답 제한 시간의 80% 정도가 기준입니다. 기본 24000ms는 제한 시간 30초 기준입니다.

## Aurora PostgreSQL

- 리소스 키: `aurora-pg`
- 기본 디멘션: `DBInstanceIdentifier`
- 파일: `src/catalog/aurora-postgresql.json`

| 지표 | metricName | 통계 | period | N/M | 연산 | 임계값 | 결측 | 기본 | 배지 |
|---|---|---|---|---|---|---|---|---|---|
| CPU 사용률 높음 | `CPUUtilization` | Average | 300s | 1/1 | >= | 80% | missing | ● | 기본, Lv1/2/3 |
| Aurora 복제 지연 | `AuroraReplicaLag` | Maximum | 300s | 1/1 | > | 1000ms | missing |  | 기본 |
| DB 커넥션 과다 | `DatabaseConnections` | Maximum | 300s | 1/1 | >= | 400 | missing |  | 기본 |
| 로컬 스토리지 부족 | `FreeLocalStorage` | Minimum | 300s | 1/1 | <= | 5GiB | missing |  | 인스턴스 의존 |
| 가용 메모리 부족 | `FreeableMemory` | Minimum | 300s | 1/1 | <= | 2GiB | missing | ● | 인스턴스 의존 |
| 데드락 발생 | `Deadlocks` | Sum | 300s | 1/1 | > | 0 | missing |  |  |
| DB 부하 높음 (DBLoad) | `DBLoad` | Average | 300s | 1/1 | > | 4 | missing |  | 추가 설정 필요, 인스턴스 의존 |

참고:
- **Aurora 복제 지연**: 단위가 밀리초입니다. 비 Aurora RDS의 ReplicaLag는 초 단위이므로 값을 그대로 옮기면 안 됩니다.
- **DB 커넥션 과다**: 파라미터 그룹의 max_connections의 80% 정도로 잡으세요. 기본값 400은 임의 값입니다.
- **로컬 스토리지 부족**: Aurora에는 FreeStorageSpace가 없습니다(볼륨 자동 확장). 임시 테이블·정렬에 쓰이는 로컬 스토리지를 봅니다. 적정 임계값은 인스턴스 클래스에 따라 다릅니다.
- **가용 메모리 부족**: 인스턴스 메모리의 10% 정도가 기준입니다. 인스턴스 클래스를 모르면 이 알람은 끄는 편이 안전합니다.
- **DB 부하 높음 (DBLoad)**: Performance Insights 활성화 필요. 임계값은 인스턴스의 vCPU 수로 맞추세요.

## Aurora MySQL

- 리소스 키: `aurora-mysql`
- 기본 디멘션: `DBInstanceIdentifier`
- 파일: `src/catalog/aurora-mysql.json`

| 지표 | metricName | 통계 | period | N/M | 연산 | 임계값 | 결측 | 기본 | 배지 |
|---|---|---|---|---|---|---|---|---|---|
| CPU 사용률 높음 | `CPUUtilization` | Average | 300s | 1/1 | >= | 80% | missing | ● | 기본, Lv1/2/3 |
| Aurora 복제 지연 | `AuroraReplicaLag` | Maximum | 300s | 1/1 | > | 1000ms | missing |  | 기본 |
| DB 커넥션 과다 | `DatabaseConnections` | Maximum | 300s | 1/1 | >= | 400 | missing |  | 기본 |
| 로컬 스토리지 부족 | `FreeLocalStorage` | Minimum | 300s | 1/1 | <= | 5GiB | missing |  | 인스턴스 의존 |
| 가용 메모리 부족 | `FreeableMemory` | Minimum | 300s | 1/1 | <= | 2GiB | missing | ● | 인스턴스 의존 |
| 데드락 발생 | `Deadlocks` | Sum | 300s | 1/1 | > | 0 | missing |  |  |
| DB 부하 높음 (DBLoad) | `DBLoad` | Average | 300s | 1/1 | > | 4 | missing |  | 추가 설정 필요, 인스턴스 의존 |

참고:
- **Aurora 복제 지연**: 단위가 밀리초입니다. 비 Aurora RDS의 ReplicaLag는 초 단위이므로 값을 그대로 옮기면 안 됩니다.
- **DB 커넥션 과다**: 파라미터 그룹의 max_connections의 80% 정도로 잡으세요. 기본값 400은 임의 값입니다.
- **로컬 스토리지 부족**: Aurora에는 FreeStorageSpace가 없습니다(볼륨 자동 확장). 임시 테이블·정렬에 쓰이는 로컬 스토리지를 봅니다. 적정 임계값은 인스턴스 클래스에 따라 다릅니다.
- **가용 메모리 부족**: 인스턴스 메모리의 10% 정도가 기준입니다. 인스턴스 클래스를 모르면 이 알람은 끄는 편이 안전합니다.
- **DB 부하 높음 (DBLoad)**: Performance Insights 활성화 필요. 임계값은 인스턴스의 vCPU 수로 맞추세요.

## RDS PostgreSQL

- 리소스 키: `rds-pg`
- 기본 디멘션: `DBInstanceIdentifier`
- 파일: `src/catalog/rds-postgresql.json`

| 지표 | metricName | 통계 | period | N/M | 연산 | 임계값 | 결측 | 기본 | 배지 |
|---|---|---|---|---|---|---|---|---|---|
| CPU 사용률 높음 | `CPUUtilization` | Average | 300s | 1/1 | >= | 80% | missing | ● | 기본, Lv1/2/3 |
| 여유 스토리지 부족 | `FreeStorageSpace` | Minimum | 300s | 1/1 | <= | 20GiB | missing |  | 기본, 인스턴스 의존 |
| 가용 메모리 부족 | `FreeableMemory` | Minimum | 300s | 1/1 | <= | 2GiB | missing | ● | 인스턴스 의존 |
| DB 커넥션 과다 | `DatabaseConnections` | Maximum | 300s | 1/1 | >= | 100 | missing |  | 기본 |
| 읽기 지연 높음 | `ReadLatency` | Average | 300s | 1/1 | > | 0.05초 | missing |  |  |
| 쓰기 지연 높음 | `WriteLatency` | Average | 300s | 1/1 | > | 0.05초 | missing |  |  |
| 읽기 복제본 지연 | `ReplicaLag` | Maximum | 300s | 1/1 | > | 30초 | missing |  |  |
| gp2 버스트 잔량 부족 | `BurstBalance` | Minimum | 300s | 1/1 | <= | 20% | missing |  | gp2 전용 |
| 디스크 큐 길이 높음 | `DiskQueueDepth` | Average | 300s | 1/1 | > | 20 | missing |  | 인스턴스 의존 |

참고:
- **여유 스토리지 부족**: 할당 스토리지의 15% 정도가 기준입니다. GiB로 입력하면 바이트로 변환됩니다.
- **가용 메모리 부족**: 인스턴스 메모리의 10% 정도가 기준입니다. 인스턴스 클래스를 모르면 끄는 편이 안전합니다.
- **DB 커넥션 과다**: max_connections의 80% 정도로 맞추세요. 기본값 100은 임의 값입니다.
- **읽기 복제본 지연**: 단위가 초입니다. Aurora의 AuroraReplicaLag는 밀리초이므로 혼동하지 마세요.
- **gp2 버스트 잔량 부족**: gp3 볼륨에는 이 지표가 없습니다.

## RDS MySQL

- 리소스 키: `rds-mysql`
- 기본 디멘션: `DBInstanceIdentifier`
- 파일: `src/catalog/rds-mysql.json`

| 지표 | metricName | 통계 | period | N/M | 연산 | 임계값 | 결측 | 기본 | 배지 |
|---|---|---|---|---|---|---|---|---|---|
| CPU 사용률 높음 | `CPUUtilization` | Average | 300s | 1/1 | >= | 80% | missing | ● | 기본, Lv1/2/3 |
| 여유 스토리지 부족 | `FreeStorageSpace` | Minimum | 300s | 1/1 | <= | 20GiB | missing |  | 기본, 인스턴스 의존 |
| 가용 메모리 부족 | `FreeableMemory` | Minimum | 300s | 1/1 | <= | 2GiB | missing | ● | 인스턴스 의존 |
| DB 커넥션 과다 | `DatabaseConnections` | Maximum | 300s | 1/1 | >= | 100 | missing |  | 기본 |
| 읽기 지연 높음 | `ReadLatency` | Average | 300s | 1/1 | > | 0.05초 | missing |  |  |
| 쓰기 지연 높음 | `WriteLatency` | Average | 300s | 1/1 | > | 0.05초 | missing |  |  |
| 읽기 복제본 지연 | `ReplicaLag` | Maximum | 300s | 1/1 | > | 30초 | missing |  |  |
| 바이너리 로그 디스크 사용량 과다 | `BinLogDiskUsage` | Average | 300s | 1/1 | > | 10GiB | missing |  | MySQL/MariaDB 전용 |
| gp2 버스트 잔량 부족 | `BurstBalance` | Minimum | 300s | 1/1 | <= | 20% | missing |  | gp2 전용 |
| 디스크 큐 길이 높음 | `DiskQueueDepth` | Average | 300s | 1/1 | > | 20 | missing |  | 인스턴스 의존 |

참고:
- **여유 스토리지 부족**: 할당 스토리지의 15% 정도가 기준입니다. GiB로 입력하면 바이트로 변환됩니다.
- **가용 메모리 부족**: 인스턴스 메모리의 10% 정도가 기준입니다. 인스턴스 클래스를 모르면 끄는 편이 안전합니다.
- **DB 커넥션 과다**: max_connections의 80% 정도로 맞추세요. 기본값 100은 임의 값입니다.
- **읽기 복제본 지연**: 단위는 초입니다. ReplicaLag가 -1이면 복제가 비활성 상태입니다.
- **바이너리 로그 디스크 사용량 과다**: MySQL/MariaDB 전용 지표. 복제본이 밀리거나 binlog 보존이 길면 증가합니다.
- **gp2 버스트 잔량 부족**: gp3 볼륨에는 이 지표가 없습니다.

## RDS MariaDB

- 리소스 키: `rds-mariadb`
- 기본 디멘션: `DBInstanceIdentifier`
- 파일: `src/catalog/rds-mariadb.json`

| 지표 | metricName | 통계 | period | N/M | 연산 | 임계값 | 결측 | 기본 | 배지 |
|---|---|---|---|---|---|---|---|---|---|
| CPU 사용률 높음 | `CPUUtilization` | Average | 300s | 1/1 | >= | 80% | missing | ● | 기본, Lv1/2/3 |
| 여유 스토리지 부족 | `FreeStorageSpace` | Minimum | 300s | 1/1 | <= | 20GiB | missing |  | 기본, 인스턴스 의존 |
| 가용 메모리 부족 | `FreeableMemory` | Minimum | 300s | 1/1 | <= | 2GiB | missing | ● | 인스턴스 의존 |
| DB 커넥션 과다 | `DatabaseConnections` | Maximum | 300s | 1/1 | >= | 100 | missing |  | 기본 |
| 읽기 지연 높음 | `ReadLatency` | Average | 300s | 1/1 | > | 0.05초 | missing |  |  |
| 쓰기 지연 높음 | `WriteLatency` | Average | 300s | 1/1 | > | 0.05초 | missing |  |  |
| 읽기 복제본 지연 | `ReplicaLag` | Maximum | 300s | 1/1 | > | 30초 | missing |  |  |
| 바이너리 로그 디스크 사용량 과다 | `BinLogDiskUsage` | Average | 300s | 1/1 | > | 10GiB | missing |  | MySQL/MariaDB 전용 |
| gp2 버스트 잔량 부족 | `BurstBalance` | Minimum | 300s | 1/1 | <= | 20% | missing |  | gp2 전용 |
| 디스크 큐 길이 높음 | `DiskQueueDepth` | Average | 300s | 1/1 | > | 20 | missing |  | 인스턴스 의존 |

참고:
- **여유 스토리지 부족**: 할당 스토리지의 15% 정도가 기준입니다. GiB로 입력하면 바이트로 변환됩니다.
- **가용 메모리 부족**: 인스턴스 메모리의 10% 정도가 기준입니다. 인스턴스 클래스를 모르면 끄는 편이 안전합니다.
- **DB 커넥션 과다**: max_connections의 80% 정도로 맞추세요. 기본값 100은 임의 값입니다.
- **읽기 복제본 지연**: 단위는 초입니다. ReplicaLag가 -1이면 복제가 비활성 상태입니다.
- **바이너리 로그 디스크 사용량 과다**: MySQL/MariaDB 전용 지표. 복제본이 밀리거나 binlog 보존이 길면 증가합니다.
- **gp2 버스트 잔량 부족**: gp3 볼륨에는 이 지표가 없습니다.

## RDS Oracle

- 리소스 키: `rds-oracle`
- 기본 디멘션: `DBInstanceIdentifier`
- 파일: `src/catalog/rds-oracle.json`

| 지표 | metricName | 통계 | period | N/M | 연산 | 임계값 | 결측 | 기본 | 배지 |
|---|---|---|---|---|---|---|---|---|---|
| CPU 사용률 높음 | `CPUUtilization` | Average | 300s | 1/1 | >= | 80% | missing | ● | 기본, Lv1/2/3 |
| 여유 스토리지 부족 | `FreeStorageSpace` | Minimum | 300s | 1/1 | <= | 20GiB | missing |  | 기본, 인스턴스 의존 |
| 가용 메모리 부족 | `FreeableMemory` | Minimum | 300s | 1/1 | <= | 2GiB | missing | ● | 인스턴스 의존 |
| DB 커넥션 과다 | `DatabaseConnections` | Maximum | 300s | 1/1 | >= | 100 | missing |  | 기본 |
| 읽기 지연 높음 | `ReadLatency` | Average | 300s | 1/1 | > | 0.05초 | missing |  |  |
| 쓰기 지연 높음 | `WriteLatency` | Average | 300s | 1/1 | > | 0.05초 | missing |  |  |
| 읽기 복제본 지연 | `ReplicaLag` | Maximum | 300s | 1/1 | > | 30초 | missing |  |  |
| gp2 버스트 잔량 부족 | `BurstBalance` | Minimum | 300s | 1/1 | <= | 20% | missing |  | gp2 전용 |
| 디스크 큐 길이 높음 | `DiskQueueDepth` | Average | 300s | 1/1 | > | 20 | missing |  | 인스턴스 의존 |

참고:
- **여유 스토리지 부족**: 할당 스토리지의 15% 정도가 기준입니다. GiB로 입력하면 바이트로 변환됩니다.
- **가용 메모리 부족**: 인스턴스 메모리의 10% 정도가 기준입니다. 인스턴스 클래스를 모르면 끄는 편이 안전합니다.
- **DB 커넥션 과다**: 동시 접속 한도의 80% 정도로 맞추세요. 기본값 100은 임의 값입니다.
- **읽기 복제본 지연**: 단위는 초입니다. ReplicaLag가 -1이면 복제가 비활성 상태입니다.
- **gp2 버스트 잔량 부족**: gp3 볼륨에는 이 지표가 없습니다.

## RDS SQL Server

- 리소스 키: `rds-sqlserver`
- 기본 디멘션: `DBInstanceIdentifier`
- 파일: `src/catalog/rds-sqlserver.json`

| 지표 | metricName | 통계 | period | N/M | 연산 | 임계값 | 결측 | 기본 | 배지 |
|---|---|---|---|---|---|---|---|---|---|
| CPU 사용률 높음 | `CPUUtilization` | Average | 300s | 1/1 | >= | 80% | missing | ● | 기본, Lv1/2/3 |
| 여유 스토리지 부족 | `FreeStorageSpace` | Minimum | 300s | 1/1 | <= | 20GiB | missing |  | 기본, 인스턴스 의존 |
| 가용 메모리 부족 | `FreeableMemory` | Minimum | 300s | 1/1 | <= | 2GiB | missing | ● | 인스턴스 의존 |
| DB 커넥션 과다 | `DatabaseConnections` | Maximum | 300s | 1/1 | >= | 100 | missing |  | 기본 |
| 읽기 지연 높음 | `ReadLatency` | Average | 300s | 1/1 | > | 0.05초 | missing |  |  |
| 쓰기 지연 높음 | `WriteLatency` | Average | 300s | 1/1 | > | 0.05초 | missing |  |  |
| 읽기 복제본 지연 | `ReplicaLag` | Maximum | 300s | 1/1 | > | 30초 | missing |  |  |
| gp2 버스트 잔량 부족 | `BurstBalance` | Minimum | 300s | 1/1 | <= | 20% | missing |  | gp2 전용 |
| 디스크 큐 길이 높음 | `DiskQueueDepth` | Average | 300s | 1/1 | > | 20 | missing |  | 인스턴스 의존 |

참고:
- **여유 스토리지 부족**: 할당 스토리지의 15% 정도가 기준입니다. GiB로 입력하면 바이트로 변환됩니다.
- **가용 메모리 부족**: 인스턴스 메모리의 10% 정도가 기준입니다. 인스턴스 클래스를 모르면 끄는 편이 안전합니다.
- **DB 커넥션 과다**: 동시 접속 한도의 80% 정도로 맞추세요. 기본값 100은 임의 값입니다.
- **읽기 복제본 지연**: 읽기 복제본(Enterprise 에디션 등)이 있을 때만 데이터가 있습니다. 단위는 초입니다.
- **gp2 버스트 잔량 부족**: gp3 볼륨에는 이 지표가 없습니다.

## 계정 보안 (CloudTrail)

- 리소스 키: `account-security`
- 기본 디멘션: ``
- 파일: `src/catalog/account-security.json`

| 지표 | metricName | 통계 | period | N/M | 연산 | 임계값 | 결측 | 기본 | 배지 |
|---|---|---|---|---|---|---|---|---|---|
| 콘솔 로그인 실패 | `ConsoleSignInFailures` | Sum | 300s | 1/1 | >= | 3 | notBreaching | ● | 지표필터 필요 |
| 루트 계정 사용 | `RootAccountUsage` | Sum | 300s | 1/1 | >= | 1 | notBreaching |  | 지표필터 필요 |
| 미승인 API 호출 | `UnauthorizedAPICalls` | Sum | 300s | 1/1 | >= | 1 | notBreaching |  | 지표필터 필요 |

참고:
- **콘솔 로그인 실패**: 콘솔 로그인 실패 횟수. 지표 필터가 선행되어야 합니다.
- **루트 계정 사용**: 루트 계정 사용이 감지되면 알람. 계정 전역이라 디멘션이 없습니다. 사전에 CloudTrail → CloudWatch Logs 지표 필터로 이 지표를 만들어야 하며, 네임스페이스·지표 이름은 필터 설정에 맞추세요.
- **미승인 API 호출**: AccessDenied/UnauthorizedOperation 호출 횟수. 지표 필터가 선행되어야 합니다.

