#!/usr/bin/env python3
"""
생성된 알람 명세를 botocore의 실제 CloudWatch 모델로 검증한다.
AWS API를 호출하지 않는다 (dry-run 대체).

사용: npm run validate
      (smoke.ts --json 출력을 stdin으로 받는다)
"""
import json
import sys

try:
    import botocore.session
    from botocore.validate import ParamValidator
except ImportError:
    print("botocore가 필요합니다: pip3 install botocore", file=sys.stderr)
    sys.exit(2)


global_tags: list = []


def to_params(s: dict) -> dict:
    p = {
        "AlarmName": s["alarmName"],
        "AlarmDescription": s["description"],
        "Namespace": s["namespace"],
        "MetricName": s["metricName"],
        "Dimensions": [
            {"Name": d["name"], "Value": d["value"]}
            for d in s["dimensions"]
            if d["value"]
        ],
        "Period": s["period"],
        "EvaluationPeriods": s["evaluationPeriods"],
        "DatapointsToAlarm": s["datapointsToAlarm"],
        "Threshold": s["threshold"],
        "ComparisonOperator": s["comparisonOperator"],
        "TreatMissingData": s["treatMissingData"],
        "AlarmActions": [s["snsTopicArn"]],
        "OKActions": [s["snsTopicArn"]],
    }
    if global_tags:
        p["Tags"] = [{"Key": t["key"], "Value": t["value"]} for t in global_tags]
    if s.get("statistic"):
        p["Statistic"] = s["statistic"]
    else:
        p["ExtendedStatistic"] = s["extendedStatistic"]
    if s.get("unit"):
        p["Unit"] = s["unit"]
    return p


# AWS 태그 값 허용 문자. '%'는 포함되지 않는다.
TAG_VALUE_ALLOWED = set(
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+-=._:/@"
)


def main() -> int:
    global global_tags
    payload = json.load(sys.stdin)
    specs = payload["specs"]
    global_tags = payload.get("globalTags", [])

    model = botocore.session.get_session().get_service_model("cloudwatch")
    shape = model.operation_model("PutMetricAlarm").input_shape
    known = set(shape.members.keys())
    enums = {
        n: set(m.metadata["enum"])
        for n, m in shape.members.items()
        if "enum" in m.metadata
    }
    validator = ParamValidator()

    fails = 0
    for s in specs:
        p = to_params(s)
        problems = []

        report = validator.validate(p, shape)
        if report.has_errors():
            problems.append(f"botocore: {report.generate_report()}")

        unknown = sorted(set(p) - known)
        if unknown:
            problems.append(f"모델에 없는 파라미터: {unknown}")

        for key, allowed in enums.items():
            if key in p and p[key] not in allowed:
                problems.append(f"enum 위반: {key}={p[key]!r}")

        for tag in p["Tags"]:
            bad = sorted(set(tag["Value"]) - TAG_VALUE_ALLOWED)
            if bad:
                problems.append(f"태그 {tag['Key']} 값에 허용되지 않는 문자: {bad}")

        if problems:
            fails += 1
            print(f"FAIL {s['alarmName']}")
            for msg in problems:
                print(f"  - {msg}")

    print(f"CloudWatch API 버전: {model.api_version}")
    print(f"검증 대상: {len(specs)}건")
    print(f"enum 검사 필드: {sorted(enums)}")
    print(f"결과: {'전부 통과' if fails == 0 else f'{fails}건 실패'}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
