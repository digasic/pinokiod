/*
  {
    method: "notify",
    params: {
      html: <notification html>,
      href: <link location to open>,
      target: <target for window.open()>,
      features: <windowFeatures>,
      type: <notification type>,
      silent: <disable the notification sound if true>,
    }
  }
(*/
module.exports = async (req, ondata, kernel) => {
  ondata(req.params, "notify")
}
