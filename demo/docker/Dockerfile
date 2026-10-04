FROM python:3.12-slim
COPY app.py run.sh /srv/
COPY svc health rotate-logs /usr/local/bin/
COPY app.conf.good /srv/app.conf.good
RUN chmod +x /srv/run.sh /usr/local/bin/svc /usr/local/bin/health /usr/local/bin/rotate-logs \
 && cp /srv/app.conf.good /etc/app.conf && mkdir -p /var/log/app
CMD ["/srv/run.sh"]
