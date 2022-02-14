<template>
  <div id="app">
    <v-app>
      <v-row>
        <v-col cols="6">
          <v-toolbar style="flex-grow: 0">
            <v-toolbar-title>Enx</v-toolbar-title>
            <v-autocomplete
              v-model="select"
              :loading="loading"
              :items="items"
              :search-input.sync="search"
              cache-items
              class="mx-4"
              hide-no-data
              hide-details
              label="Search"
              solo-inverted
              auto-select-first
            ></v-autocomplete>
            <v-btn icon @click="thirdParty">
              <v-icon>mdi-heart</v-icon>
            </v-btn>
          </v-toolbar>
        </v-col>
        <v-col>
          <v-card
            class="mx-auto"
          >
            <v-card-text>
              <div>.</div>
              <p class="display-1 text--primary">
                {{ dict.English }}
              </p>
              <p>{{ dict.Chinese }}</p>
              <div class="text--primary">
                {{ dict.Pronunciation }}
              </div>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <v-main>
      </v-main>
    </v-app>

  </div>
</template>

<script lang="ts">
import { Component, Vue, Watch } from 'vue-property-decorator'
import Axios from 'axios'

@Component({
  components: {}
})
export default class Home extends Vue {
  loading = false
  search = null
  select = null
  items = []
  word = 'test'
  drawer = false
  env = ''
  dict = new Map()
  timeout = 0

  thirdParty (): void {
    Axios
      .get('/third-party')
      .then(
        response => {
          console.log(response.data)
          this.items = response.data
        }
      )
  }

  @Watch('search')
  onChildChanged (val: string, oldVal: string) {
    console.log('old value: ' + oldVal + ', new value: ' + val)
    clearTimeout(this.timeout)
    this.timeout = setTimeout(() => {
      this.querySelections(val)
    }, 1000)
  }

  querySelections (v: string): void {
    this.loading = true
    console.log('search: ' + v)
    Axios
      .get('/do-search', {
        params: { key: v }
      })
      .then(
        response => {
          this.items = response.data.WordList
          this.dict = response.data.Dict
          this.loading = false
          console.log('search response: key: ' + v + ', result: ' + response.data.WordList)
        }
      )
  }

  mounted () {
    this.env = process.env.NODE_ENV
    console.log('mounted: ' + process.env.NODE_ENV)
  }
}
</script>
<style lang="stylus">
</style>
