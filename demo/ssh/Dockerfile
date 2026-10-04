# SANDBOX "remote machine" reached over SSH. Same demo service and known-good copies as web-1 (demo/docker),
# but the executor gets in with ssh as the unprivileged user nsuser (key only, no password, no root login, no sudo).
# Build context is demo/ (see docker-compose.yml).
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssh-server && rm -rf /var/lib/apt/lists/* \
 && ssh-keygen -A && useradd -m -s /bin/sh nsuser && usermod -p '*' nsuser && mkdir -p /etc/ssh/authorized_keys
COPY docker/app.py docker/run.sh docker/status.html /srv/
COPY docker/svc docker/health docker/rotate-logs /usr/local/bin/
COPY docker/app.conf.good /srv/app.conf.good
COPY docker/site/ /srv/app/
COPY ssh/start.sh /srv/start.sh
COPY ssh/sshd_config /etc/ssh/sshd_config
COPY ssh/keys/id_ed25519.pub /etc/ssh/authorized_keys/nsuser
RUN chmod +x /srv/run.sh /srv/start.sh /usr/local/bin/svc /usr/local/bin/health /usr/local/bin/rotate-logs \
 && cp /srv/app.conf.good /etc/app.conf \
 && cp -a /srv/app /srv/app.snapshot && (cd /srv && find app -type f | sort | xargs sha256sum > /srv/app.manifest) \
 && mkdir -p /var/log/app && chmod 644 /etc/ssh/authorized_keys/nsuser \
 && chown -R nsuser:nsuser /srv /etc/app.conf /var/log/app && chown nsuser:nsuser /var/log
CMD ["/srv/start.sh"]
