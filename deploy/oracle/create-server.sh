#!/usr/bin/env bash
# Creates the Q express server from Oracle Cloud Shell, in one run, for a helper
# who owns the Oracle account. Every console choice of the long guide is made
# here: network and public subnet, firewall (22/80/443 only), an Always Free A1
# server (2 OCPU, 12 GB, the current free allowance) with the owner's SSH key,
# a fixed public IP and a 1 USD budget alert. Safe to run again: it reuses what
# already exists. The text has no exclamation marks on purpose: it is pasted
# into an interactive shell, where history expansion would mangle them.

KEY='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAvfe1twCyPlJlaFPCJNzhCj2Kst2D0mbGNXJp+6Z0bR q-express-owner'
C="${OCI_TENANCY:-$(sed -n 's/^tenancy *= *//p' "${OCI_CLI_CONFIG_FILE:-$HOME/.oci/config}" 2>/dev/null | head -n1)}"
NAME=q-express

say() { printf '\n>>> %s\n' "$*"; }
none() { [ -z "$1" ] || [ "$1" = "None" ] || [ "$1" = "null" ]; }
fail() { printf '\n*** XATO: %s\n*** Shu oynani rasmga olib bizga yuboring.\n\n' "$*"; exit 1; }

[ -n "$C" ] || fail "bu buyruq Oracle Cloud Shell ichida ishlatilishi kerak"
command -v oci >/dev/null || fail "bu buyruq Oracle Cloud Shell ichida ishlatilishi kerak"

state() { oci compute instance get --instance-id "$1" --query 'data."lifecycle-state"' --raw-output 2>/dev/null; }
vnic_ip() { oci network vnic get --vnic-id "$1" --query 'data."public-ip"' --raw-output 2>/dev/null; }

# A reserved IP survives the server being recreated; an ephemeral one is the fallback.
attach_ip() {
  VNIC=
  for _ in $(seq 30); do
    VNIC=$(oci compute vnic-attachment list -c "$C" --instance-id "$1" \
      --query 'data[?"lifecycle-state"==`"ATTACHED"`] | [0]."vnic-id"' --raw-output 2>/dev/null)
    none "$VNIC" || break
    sleep 10
  done
  none "$VNIC" && fail "serverning tarmoq kartasi topilmadi"
  IP=$(vnic_ip "$VNIC")
  none "$IP" || return 0
  say "IP manzil biriktiryapman"
  PRIV=$(oci network private-ip list --vnic-id "$VNIC" --query 'data[0].id' --raw-output)
  none "$PRIV" && fail "serverning ichki IP manzili topilmadi"
  oci network public-ip create -c "$C" --lifetime RESERVED --display-name qe-ip --private-ip-id "$PRIV" \
    --wait-for-state ASSIGNED >/dev/null 2>&1
  IP=$(vnic_ip "$VNIC")
  if none "$IP"; then
    oci network public-ip create -c "$C" --lifetime EPHEMERAL --private-ip-id "$PRIV" \
      --wait-for-state ASSIGNED >/dev/null 2>/tmp/qe.err || { cat /tmp/qe.err; fail "IP manzil biriktirilmadi"; }
    IP=$(vnic_ip "$VNIC")
  fi
  none "$IP" && fail "IP manzil biriktirilmadi"
  return 0
}

budget() {
  oci budgets budget list -c "$C" --target-type ALL --query 'data[?"display-name"==`"qe-budget"`] | [0].id' \
    --raw-output 2>/dev/null | grep -q ocid && { echo "    bor"; return; }
  EMAIL=$(oci iam user get --user-id "${OCI_CS_USER_OCID:-x}" --query 'data.email' --raw-output 2>/dev/null)
  B=$(oci budgets budget create -c "$C" --amount 1 --reset-period MONTHLY --target-type COMPARTMENT \
    --targets "[\"$C\"]" --display-name qe-budget --query data.id --raw-output 2>/dev/null)
  case "$B" in ocid1.*) ;; *) echo "    qo'yilmadi (muhim emas)"; return;; esac
  if oci budgets alert-rule create --budget-id "$B" --type ACTUAL --threshold 100 --threshold-type PERCENTAGE \
      ${EMAIL:+--recipients "$EMAIL"} >/dev/null 2>&1; then echo "    qo'yildi ${EMAIL}"; else echo "    qo'yilmadi (muhim emas)"; fi
}

finish() {
  case "$(state "$1")" in
    STOPPED|STOPPING)
      say "Server to'xtatilgan ekan, yoqyapman"
      oci compute instance action --instance-id "$1" --action START --wait-for-state RUNNING >/dev/null 2>&1 \
        || fail "server yoqilmadi";;
    PROVISIONING|STARTING)
      say "Server yonishini kutyapman"
      oci compute instance get --instance-id "$1" --wait-for-state RUNNING >/dev/null 2>&1;;
  esac
  attach_ip "$1"
  say "Byudjet ogohlantirishi (1 USD)"
  budget
  printf '\n==============================\n'
  printf ' TAYYOR. SHUNI YUBORING:\n'
  printf ' IP: %s\n' "$IP"
  printf ' Region: %s\n' "${OCI_REGION:-?}"
  printf '==============================\n\n'
  exit 0
}

say "Tekshiryapman: server avval ochilganmi"
INST=$(oci compute instance list -c "$C" --display-name "$NAME" \
  --query 'data[?contains(`["TERMINATED","TERMINATING"]`, "lifecycle-state") == `false`] | [0].id' --raw-output 2>/dev/null)
none "$INST" || finish "$INST"

say "1/4 Tarmoq (VCN, internet gateway, public subnet)"
VCN=$(oci network vcn list -c "$C" --display-name qe-vcn --query 'data[0].id' --raw-output 2>/dev/null)
if none "$VCN"; then
  VCN=$(oci network vcn create -c "$C" --cidr-block 10.0.0.0/16 --display-name qe-vcn --dns-label qevcn \
    --wait-for-state AVAILABLE --query data.id --raw-output) || fail "tarmoq yaratilmadi"
fi
IGW=$(oci network internet-gateway list -c "$C" --vcn-id "$VCN" --query 'data[0].id' --raw-output 2>/dev/null)
if none "$IGW"; then
  IGW=$(oci network internet-gateway create -c "$C" --vcn-id "$VCN" --is-enabled true --display-name qe-igw \
    --wait-for-state AVAILABLE --query data.id --raw-output) || fail "internet gateway yaratilmadi"
fi
RT=$(oci network vcn get --vcn-id "$VCN" --query 'data."default-route-table-id"' --raw-output)
SL=$(oci network vcn get --vcn-id "$VCN" --query 'data."default-security-list-id"' --raw-output)
none "$RT" && fail "marshrut jadvali topilmadi"
oci network route-table update --rt-id "$RT" --force \
  --route-rules "[{\"destination\":\"0.0.0.0/0\",\"destinationType\":\"CIDR_BLOCK\",\"networkEntityId\":\"$IGW\"}]" >/dev/null \
  || fail "marshrut qo'yilmadi"

say "2/4 Xavfsizlik: faqat 22 (SSH), 80, 443 portlar ochiq"
oci network security-list update --security-list-id "$SL" --force \
  --ingress-security-rules '[
    {"source":"0.0.0.0/0","protocol":"6","tcpOptions":{"destinationPortRange":{"min":22,"max":22}}},
    {"source":"0.0.0.0/0","protocol":"6","tcpOptions":{"destinationPortRange":{"min":80,"max":80}}},
    {"source":"0.0.0.0/0","protocol":"6","tcpOptions":{"destinationPortRange":{"min":443,"max":443}}},
    {"source":"0.0.0.0/0","protocol":"1","icmpOptions":{"type":3,"code":4}}]' \
  --egress-security-rules '[{"destination":"0.0.0.0/0","protocol":"all"}]' >/dev/null \
  || fail "portlar ochilmadi"

SUB=$(oci network subnet list -c "$C" --vcn-id "$VCN" --query 'data[0].id' --raw-output 2>/dev/null)
if none "$SUB"; then
  SUB=$(oci network subnet create -c "$C" --vcn-id "$VCN" --cidr-block 10.0.0.0/24 --display-name qe-subnet \
    --dns-label qesub --route-table-id "$RT" --security-list-ids "[\"$SL\"]" \
    --wait-for-state AVAILABLE --query data.id --raw-output) || fail "subnet yaratilmadi"
fi

say "3/4 Ubuntu 24.04 rasmini topyapman"
IMG=$(oci compute image list -c "$C" --operating-system "Canonical Ubuntu" --operating-system-version "24.04" \
  --shape VM.Standard.A1.Flex --sort-by TIMECREATED --sort-order DESC \
  --query 'data[?contains("display-name", `"Minimal"`) == `false`] | [0].id' --raw-output)
none "$IMG" && fail "Ubuntu 24.04 topilmadi"

say "4/4 Bepul server ochyapman: Ampere A1, 100 GB disk (bir necha daqiqa)"
printf '%s\n' "$KEY" > /tmp/qe.pub
ADS=$(oci iam availability-domain list -c "$C" --query 'join(`" "`, data[].name)' --raw-output)
none "$ADS" && fail "zonalar topilmadi"
OTHER=
for SIZE in "2 12" "1 6"; do
  set -- $SIZE
  for AD in $ADS; do
    printf '    %s OCPU, %s GB, %s ... ' "$1" "$2" "${AD##*-}"
    INST=$(oci compute instance launch -c "$C" --availability-domain "$AD" \
        --shape VM.Standard.A1.Flex --shape-config "{\"ocpus\":$1,\"memoryInGBs\":$2}" \
        --image-id "$IMG" --subnet-id "$SUB" --assign-public-ip false --display-name "$NAME" \
        --ssh-authorized-keys-file /tmp/qe.pub --boot-volume-size-in-gbs 100 \
        --is-pv-encryption-in-transit-enabled true \
        --availability-config '{"recoveryAction":"RESTORE_INSTANCE"}' \
        --wait-for-state RUNNING --max-wait-seconds 600 --query data.id --raw-output 2>/tmp/qe.err)
    # A server can be made and then dropped for lack of room: only a live one counts.
    case "$INST" in ocid1.instance.*)
      case "$(state "$INST")" in
        TERMINATED|TERMINATING) ;;
        *) echo "bo'ldi"; finish "$INST";;
      esac;;
    esac
    if grep -qi "capacity" /tmp/qe.err || [ -n "$INST" ]; then
      echo "joy yo'q"
    else
      echo "boshqa xato:"; sed 's/^/      /' /tmp/qe.err | head -n 12; OTHER=1
    fi
    sleep 5
  done
done

[ -n "$OTHER" ] && fail "server ochilmadi (yuqoridagi xatoga qarang)"
printf '\n*** Hozir Frankfurtda bo'\''sh bepul server qolmagan.\n'
printf '*** 2-3 soatdan keyin (yaxshisi erta tongda) shu buyruqni yana joylang.\n\n'
exit 1
