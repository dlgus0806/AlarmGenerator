# 알람 지표 카탈로그

> 이 문서는 `src/catalog/*.json` 에서 자동 생성됩니다. **직접 고치지 마세요.**
> 지표를 추가/수정하려면 아래 "파일 위치"의 JSON을 편집하고 `npm run docs`로 이 문서를 다시 생성하세요.

생성 시각: 2026-08-29T09:34:37.972Z

## 파일 위치

| 리소스 | 파일 |
|---|---|
| EC2 인스턴스 | `src/catalog/ec2.json` |
| ALB (Application Load Balancer) | `src/catalog/alb.json` |
| Aurora PostgreSQL (인스턴스 단위) | `src/catalog/aurora-postgresql.json` |
| RDS PostgreSQL (비 Aurora) | `src/catalog/rds-postgresql.json` |
| RDS MySQL / MariaDB (비 Aurora) | `src/catalog/rds-mysql.json` |
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
| CPU 사용률 높음 | `CPUUtilization` | Average | 300s | 2/3 | >= | 80% | missing | ● | 기본, Lv1/2/3 |
| 인스턴스 상태 검사 실패 | `StatusCheckFailed_Instance` | Maximum | 60s | 2/2 | >= | 1 | missing |  | 기본 |
| 시스템 상태 검사 실패 | `StatusCheckFailed_System` | Maximum | 60s | 2/2 | >= | 1 | missing |  | 기본 |
| CPU 크레딧 부족 | `CPUCreditBalance` | Minimum | 300s | 3/3 | <= | 20 | missing |  | T 계열 전용 |
| EBS IO 버스트 잔량 부족 | `EBSIOBalance%` | Minimum | 300s | 3/3 | <= | 20% | missing |  | Nitro 전용 |
| 메모리 사용률 높음 | `mem_used_percent` | Average | 300s | 2/3 | >= | 85% | missing | ● | 에이전트 필요 |
| 디스크 사용률 높음 | `disk_used_percent` | Average | 300s | 3/3 | >= | 85% | missing | ● | 에이전트 필요 |

참고:
- **인스턴스 상태 검사 실패**: OS 레벨 문제. 재부팅으로 복구되는 경우가 많다. (결측=missing: 지표가 끊기면 상태 유지)
- **시스템 상태 검사 실패**: AWS 인프라 문제. 인스턴스 중지/시작으로 다른 호스트로 이동해야 복구된다. (결측=missing)
- **CPU 크레딧 부족**: T2/T3/T4g 인스턴스에만 존재한다. 다른 계열에 걸면 영구 INSUFFICIENT_DATA.
- **EBS IO 버스트 잔량 부족**: Nitro 기반 인스턴스 + 버스트 볼륨에서만 나온다.
- **메모리 사용률 높음**: CloudWatch Agent 설치 필요. 에이전트 설정에 따라 디멘션 구성이 달라질 수 있으니 list-metrics로 확인하세요.
- **디스크 사용률 높음**: 에이전트 설정에 따라 device / fstype 디멘션이 추가로 필요할 수 있습니다. list-metrics로 실제 디멘션을 확인하세요.

## ALB (Application Load Balancer)

- 리소스 키: `alb`
- 기본 디멘션: `LoadBalancer`
- 파일: `src/catalog/alb.json`

| 지표 | metricName | 통계 | period | N/M | 연산 | 임계값 | 결측 | 기본 | 배지 |
|---|---|---|---|---|---|---|---|---|---|
| ELB 5xx 응답 | `HTTPCode_ELB_5XX_Count` | Sum | 300s | 2/2 | > | 10 | missing | ● | 기본 |
| 타깃 5xx 응답 | `HTTPCode_Target_5XX_Count` | Sum | 300s | 2/2 | > | 20 | missing | ● | 기본 |
| 응답 시간 p99 높음 | `TargetResponseTime` | p99 (백분위) | 300s | 2/3 | > | 2초 | missing |  | 기본 |
| 비정상 타깃 존재 | `UnHealthyHostCount` | Maximum | 60s | 2/3 | >= | 1 | missing |  | 기본 |
| 연결 거부 발생 | `RejectedConnectionCount` | Sum | 300s | 2/2 | > | 0 | missing |  |  |
| 타깃 연결 오류 | `TargetConnectionErrorCount` | Sum | 300s | 2/2 | > | 10 | missing |  |  |

참고:
- **ELB 5xx 응답**: ALB 자체가 5xx를 반환한 경우. 타깃 문제와 구분된다.
- **연결 거부 발생**: ALB 동시 연결 한도 초과. 0을 넘기면 이미 요청이 버려지고 있다.

## Aurora PostgreSQL (인스턴스 단위)

- 리소스 키: `aurora-pg`
- 기본 디멘션: `DBInstanceIdentifier`
- 파일: `src/catalog/aurora-postgresql.json`

| 지표 | metricName | 통계 | period | N/M | 연산 | 임계값 | 결측 | 기본 | 배지 |
|---|---|---|---|---|---|---|---|---|---|
| CPU 사용률 높음 | `CPUUtilization` | Average | 300s | 2/3 | >= | 80% | missing | ● | 기본, Lv1/2/3 |
| Aurora 복제 지연 | `AuroraReplicaLag` | Maximum | 300s | 2/3 | > | 1000ms | missing |  | 기본 |
| DB 커넥션 과다 | `DatabaseConnections` | Maximum | 300s | 2/3 | >= | 400 | missing |  | 기본 |
| 로컬 스토리지 부족 | `FreeLocalStorage` | Minimum | 300s | 3/3 | <= | 5GiB | missing |  | 인스턴스 의존 |
| 가용 메모리 부족 | `FreeableMemory` | Minimum | 300s | 3/3 | <= | 2GiB | missing | ● | 인스턴스 의존 |
| 데드락 발생 | `Deadlocks` | Sum | 300s | 2/2 | > | 0 | missing |  |  |
| DB 부하 높음 (DBLoad) | `DBLoad` | Average | 300s | 2/3 | > | 4 | missing |  | 추가 설정 필요, 인스턴스 의존 |

참고:
- **Aurora 복제 지연**: 단위가 밀리초입니다. 비 Aurora RDS의 ReplicaLag는 초 단위이므로 값을 그대로 옮기면 안 됩니다.
- **DB 커넥션 과다**: 파라미터 그룹의 max_connections의 80% 정도로 잡으세요. 기본값 400은 임의 값입니다.
- **로컬 스토리지 부족**: Aurora에는 FreeStorageSpace가 없습니다(볼륨 자동 확장). 임시 테이블·정렬에 쓰이는 로컬 스토리지를 봅니다. 적정 임계값은 인스턴스 클래스에 따라 다릅니다.
- **가용 메모리 부족**: 인스턴스 메모리의 10% 정도가 기준입니다. 인스턴스 클래스를 모르면 이 알람은 끄는 편이 안전합니다.
- **DB 부하 높음 (DBLoad)**: Performance Insights 활성화 필요. 임계값은 인스턴스의 vCPU 수로 맞추세요.

## RDS PostgreSQL (비 Aurora)

- 리소스 키: `rds-pg`
- 기본 디멘션: `DBInstanceIdentifier`
- 파일: `src/catalog/rds-postgresql.json`

| 지표 | metricName | 통계 | period | N/M | 연산 | 임계값 | 결측 | 기본 | 배지 |
|---|---|---|---|---|---|---|---|---|---|
| CPU 사용률 높음 | `CPUUtilization` | Average | 300s | 2/3 | >= | 80% | missing | ● | 기본, Lv1/2/3 |
| 여유 스토리지 부족 | `FreeStorageSpace` | Minimum | 300s | 2/2 | <= | 20GiB | missing |  | 기본, 인스턴스 의존 |
| 가용 메모리 부족 | `FreeableMemory` | Minimum | 300s | 3/3 | <= | 2GiB | missing | ● | 인스턴스 의존 |
| DB 커넥션 과다 | `DatabaseConnections` | Maximum | 300s | 2/3 | >= | 100 | missing |  | 기본 |
| 읽기 지연 높음 | `ReadLatency` | Average | 300s | 2/3 | > | 0.05초 | missing |  |  |
| 쓰기 지연 높음 | `WriteLatency` | Average | 300s | 2/3 | > | 0.05초 | missing |  |  |
| 읽기 복제본 지연 | `ReplicaLag` | Maximum | 300s | 2/3 | > | 30초 | missing |  |  |
| gp2 버스트 잔량 부족 | `BurstBalance` | Minimum | 300s | 3/3 | <= | 20% | missing |  | gp2 전용 |
| 디스크 큐 길이 높음 | `DiskQueueDepth` | Average | 300s | 2/3 | > | 20 | missing |  | 인스턴스 의존 |

참고:
- **여유 스토리지 부족**: 할당 스토리지의 15% 정도가 기준입니다. GiB로 입력하면 바이트로 변환됩니다.
- **가용 메모리 부족**: 인스턴스 메모리의 10% 정도. 인스턴스 클래스를 모르면 끄는 편이 안전합니다.
- **DB 커넥션 과다**: max_connections의 80% 정도로 맞추세요. 기본값 100은 임의 값입니다.
- **읽기 복제본 지연**: 단위가 초입니다. Aurora의 AuroraReplicaLag는 밀리초이므로 혼동하지 마세요.
- **gp2 버스트 잔량 부족**: gp3 볼륨에는 이 지표가 없습니다.

## RDS MySQL / MariaDB (비 Aurora)

- 리소스 키: `rds-mysql`
- 기본 디멘션: `DBInstanceIdentifier`
- 파일: `src/catalog/rds-mysql.json`

| 지표 | metricName | 통계 | period | N/M | 연산 | 임계값 | 결측 | 기본 | 배지 |
|---|---|---|---|---|---|---|---|---|---|
| CPU 사용률 높음 | `CPUUtilization` | Average | 300s | 2/3 | >= | 80% | missing | ● | 기본, Lv1/2/3 |
| 여유 스토리지 부족 | `FreeStorageSpace` | Minimum | 300s | 2/2 | <= | 20GiB | missing |  | 기본, 인스턴스 의존 |
| 가용 메모리 부족 | `FreeableMemory` | Minimum | 300s | 3/3 | <= | 2GiB | missing | ● | 인스턴스 의존 |
| DB 커넥션 과다 | `DatabaseConnections` | Maximum | 300s | 2/3 | >= | 100 | missing |  | 기본 |
| 읽기 지연 높음 | `ReadLatency` | Average | 300s | 2/3 | > | 0.05초 | missing |  |  |
| 쓰기 지연 높음 | `WriteLatency` | Average | 300s | 2/3 | > | 0.05초 | missing |  |  |
| 읽기 복제본 지연 | `ReplicaLag` | Maximum | 300s | 2/3 | > | 30초 | missing |  |  |
| 바이너리 로그 디스크 사용량 과다 | `BinLogDiskUsage` | Average | 300s | 2/3 | > | 10GiB | missing |  | MySQL/MariaDB 전용 |
| gp2 버스트 잔량 부족 | `BurstBalance` | Minimum | 300s | 3/3 | <= | 20% | missing |  | gp2 전용 |
| 디스크 큐 길이 높음 | `DiskQueueDepth` | Average | 300s | 2/3 | > | 20 | missing |  | 인스턴스 의존 |

참고:
- **여유 스토리지 부족**: 할당 스토리지의 15% 정도가 기준입니다. GiB로 입력하면 바이트로 변환됩니다.
- **가용 메모리 부족**: 인스턴스 메모리의 10% 정도. 인스턴스 클래스를 모르면 끄는 편이 안전합니다.
- **DB 커넥션 과다**: max_connections의 80% 정도로 맞추세요. 기본값 100은 임의 값입니다.
- **읽기 복제본 지연**: 단위는 초입니다. ReplicaLag가 -1이면 복제가 비활성 상태입니다.
- **바이너리 로그 디스크 사용량 과다**: MySQL/MariaDB 전용 지표. 복제본이 밀리거나 binlog 보존이 길면 증가합니다.
- **gp2 버스트 잔량 부족**: gp3 볼륨에는 이 지표가 없습니다.

