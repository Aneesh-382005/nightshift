FROM python:3.12-slim
COPY app.py run.sh status.html /srv/
COPY svc health rotate-logs /usr/local/bin/
COPY app.conf.good /srv/app.conf.good
COPY site/ /srv/app/
RUN chmod +x /srv/run.sh /usr/local/bin/svc /usr/local/bin/health /usr/local/bin/rotate-logs \
 && cp /srv/app.conf.good /etc/app.conf \
 && cp -a /srv/app /srv/app.snapshot && (cd /srv && find app -type f | sort | xargs sha256sum > /srv/app.manifest) && mkdir -p /var/log/app
CMD ["/srv/run.sh"]
