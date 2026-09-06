# CalPolySOC EC2 API wrapper — dev container packaging
# (prod runs this on the host under systemd; this image mirrors that layout)

FROM python:3.11-slim
ARG APP_REVISION=development
ENV APP_REVISION=$APP_REVISION
LABEL org.opencontainers.image.revision=$APP_REVISION

COPY requirements.txt /tmp/requirements.txt
RUN apt-get update \
 && apt-get install -y --no-install-recommends genisoimage curl \
 && rm -rf /var/lib/apt/lists/* \
 && pip install --no-cache-dir -r /tmp/requirements.txt

WORKDIR /opt/calpoly-cloud

COPY ec2-api.py ec2_wsgi.py bootstrap-patch.py ./
COPY cloudctl /usr/local/bin/cloudctl
RUN chmod +x /usr/local/bin/cloudctl \
 && mkdir -p /var/lib/calpoly-cloud /etc/calpoly-cloud

# Apply env-driven dev overrides (VLAN tag, template VMID map), then serve.
# Env vars consumed here (all optional):
#   PROXMOX_VLAN_TAG          - add ",tag=N" to cloudctl net0 definitions
#   IMAGE_TEMPLATE_VMIDS_JSON - replace the ami->template-vmid map in ec2-api.py
CMD ["sh", "-c", "python bootstrap-patch.py && exec gunicorn --workers 2 --threads 4 --timeout 900 --bind 0.0.0.0:8090 ec2_wsgi:app"]
