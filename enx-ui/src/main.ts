import Vue from 'vue'
import App from './App.vue'
import './registerServiceWorker'
import router from './router'
import store from './store'
import vuetify from './plugins/vuetify'
import Axios from 'axios'

Vue.config.productionTip = false

Vue.prototype.$axios = Axios
Axios.defaults.baseURL = '/api'
new Vue({
  router,
  store,
  vuetify,
  render: h => h(App)
}).$mount('#app')
