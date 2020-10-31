<template>
  <div id="app">
    <v-app>
      <v-toolbar style="flex-grow: 0">
        <v-toolbar-title>Enx</v-toolbar-title>
        <v-autocomplete
          v-model="select"
          :loading="loading"
          :items="items"
          :search-input.sync="search"
          cache-items
          class="mx-4"
          flat
          hide-no-data
          hide-details
          label="Search"
          solo-inverted
        ></v-autocomplete>
        <v-btn icon>
          <v-icon>mdi-dots-vertical</v-icon>
        </v-btn>
      </v-toolbar>
      <v-main>
        <v-card
          class="mx-auto"
          max-width="344"
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
export default class App extends Vue {
  loading = false
  search = null
  select = null
  items = []
  word = 'test'
  drawer = false
  env = ''
  dict = new Map()

  @Watch('search')
  onChildChanged (val: string, oldVal: string) {
    console.log('watch search')
    console.log('val: ' + val)
    console.log('old val: ' + oldVal)
    this.querySelections(val)
  }

  doSearch (): void {
    console.log(this.word)
    Axios
      .get('/do-search')
      .then(
        response => {
          console.log(response.data)
          this.items = response.data
        }
      )
  }

  querySelections (v: string): void {
    this.loading = true
    // Simulated ajax query
    Axios
      .get('/do-search', {
        params: { key: v }
      })
      .then(
        response => {
          this.items = response.data.WordList
          this.dict = response.data.Dict
          this.loading = false
          console.log('search result: ' + response.data.WordList)
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
